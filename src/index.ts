import { Hono } from "hono";
import { AgentNotFoundError, getAgent } from "./agents/load";
import {
  buildLqResponse,
  formatDebatePrompt,
  RequestBodyError,
  readLqRequest,
} from "./contract/lq";
import { estimateActualCost, estimateCostFromTokens, estimateReservedCost } from "./cost/estimate";
import {
  CostLedgerUnavailableError,
  createCostLedger,
  currentMonth,
  MonthlySpendLedger,
} from "./cost/ledger";
import {
  buildRequestLogContext,
  logContextBudgetExceeded,
  logModelInputPrepared,
  logProviderEvent,
  logRequestAccepted,
  logRequestCompleted,
  logRequestFailed,
  logRequestRejected,
  logSpendCapReached,
  publicDebatePayloadLoggingEnabled,
  type RequestLogContext,
  withAgentId,
} from "./observability/logging";
import { buildDebateMessages } from "./prompt/build-system";
import { runConfiguredModel } from "./providers";
import { checkContextBudget } from "./providers/context-budget";
import { ProviderError } from "./providers/types";
import { getTokenHashForAgent, isAuthorized } from "./security/auth";
import { createCanary } from "./security/canary";
import { filterModelOutput } from "./security/output-filter";
import type { Env } from "./types";

export { MonthlySpendLedger };

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
});

app.get("/", (c) =>
  c.json({
    name: "lq-debate-agent",
    contract:
      "POST /debate or /agents/:agentId/debate with { prompt, session_id }, returns { text }",
  }),
);

app.post("/", async (c) => handleAgentRequest(c.req.raw, c.env, undefined));
app.post("/debate", async (c) => handleAgentRequest(c.req.raw, c.env, undefined));
app.post("/agents/:agentId/debate", async (c) =>
  handleAgentRequest(c.req.raw, c.env, c.req.param("agentId")),
);
app.post("/agents/:agentId", async (c) =>
  handleAgentRequest(c.req.raw, c.env, c.req.param("agentId")),
);
app.post("/:agentId", async (c) => handleAgentRequest(c.req.raw, c.env, c.req.param("agentId")));

export default app;

async function handleAgentRequest(
  request: Request,
  env: Env,
  requestedAgentId: string | undefined,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let logContext = buildRequestLogContext(request, requestId, requestedAgentId);

  try {
    const agent = getAgent(requestedAgentId, env);
    logContext = withAgentId(logContext, agent.id);
    const tokenHash = getTokenHashForAgent(env, agent.id);
    const authorized = await isAuthorized(request.headers.get("authorization"), tokenHash);
    if (!authorized) {
      logRequestRejected(logContext, 401, "unauthorized", elapsedMs(startedAt));
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await readLqRequest(request, agent.security.maxBodyBytes);
    const logPublicPayloads = publicDebatePayloadLoggingEnabled(env);
    logRequestAccepted(logContext, elapsedMs(startedAt), agent, body, logPublicPayloads);
    const canary = createCanary();
    const debatePrompt = formatDebatePrompt(body);
    const messages = buildDebateMessages(agent, debatePrompt, canary);
    logModelInputPrepared(
      logContext,
      elapsedMs(startedAt),
      agent,
      messages,
      logPublicPayloads,
      canary,
    );
    const inputText = `${messages.system}\n\n${messages.user}`;
    const contextBudget = checkContextBudget(env, agent, inputText);
    if (!contextBudget.ok) {
      logContextBudgetExceeded(logContext, elapsedMs(startedAt), contextBudget);
      const response = buildLqResponse(
        body,
        "I cannot answer this round safely because the received debate prompt and persona exceed my configured context budget. I am preserving the round by returning this explicit limitation rather than silently omitting material.",
      );
      return Response.json(response);
    }

    const month = currentMonth();
    const reserveEstimate = estimateReservedCost({
      model: agent.model,
      inputText,
      maxOutputTokens: agent.maxOutputTokens,
    });

    const ledger = createCostLedger(env);
    const reserve = await ledger.reserve({
      agentId: agent.id,
      requestId,
      month,
      amountUsd: reserveEstimate.estimatedUsd,
      monthlyLimitUsd: agent.monthlyBudgetUsd,
    });

    if (!reserve.ok) {
      logSpendCapReached(
        logContext,
        elapsedMs(startedAt),
        reserveEstimate.estimatedUsd,
        agent.monthlyBudgetUsd,
      );
      const response = buildLqResponse(
        body,
        "This debater is temporarily paused because its configured monthly model budget has been reached.",
      );
      return Response.json(response);
    }

    try {
      const result = await runConfiguredModel(env, agent, messages, {
        logPublicPayloads,
        onProviderEvent: (event) => logProviderEvent(logContext, event),
      });
      const filtered = filterModelOutput(result.text, canary);
      const actualEstimate =
        result.usage?.inputTokens !== undefined && result.usage.outputTokens !== undefined
          ? estimateCostFromTokens(agent.model, result.usage.inputTokens, result.usage.outputTokens)
          : estimateActualCost({
              model: agent.model,
              inputText,
              outputText: result.text,
              maxOutputTokens: agent.maxOutputTokens,
            });

      await ledger.commit({
        agentId: agent.id,
        requestId,
        month,
        actualUsd: actualEstimate.estimatedUsd,
      });

      const response = buildLqResponse(body, filtered.text);
      logRequestCompleted(
        logContext,
        elapsedMs(startedAt),
        response.text.length,
        logPublicPayloads ? response.text : undefined,
      );
      return Response.json(response);
    } catch (error) {
      await ledger.refund({ agentId: agent.id, requestId, month });
      throw error;
    }
  } catch (error) {
    return errorResponse(error, logContext, elapsedMs(startedAt));
  }
}

function errorResponse(error: unknown, logContext: RequestLogContext, elapsedMs: number): Response {
  if (error instanceof RequestBodyError) {
    logRequestRejected(logContext, error.status, error.message, elapsedMs, error.diagnostic);
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof AgentNotFoundError) {
    logRequestRejected(logContext, 404, "agent_not_found", elapsedMs);
    return Response.json({ error: "agent_not_found" }, { status: 404 });
  }
  if (error instanceof ProviderError) {
    logRequestFailed(logContext, 200, error, elapsedMs);
    const diagnostic = providerFailureDiagnostic(error);
    return Response.json({ text: providerFallbackText(error, diagnostic.detail), diagnostic });
  }
  if (error instanceof CostLedgerUnavailableError) {
    logRequestFailed(logContext, 503, error, elapsedMs);
    return Response.json({ error: "cost_ledger_unavailable" }, { status: 503 });
  }

  logRequestFailed(logContext, 500, error, elapsedMs);
  return Response.json({ error: "internal_error" }, { status: 500 });
}

interface ProviderFailureDiagnostic {
  kind: "provider_error";
  detail: string;
  status?: number;
}

function providerFallbackText(error: ProviderError, detail = publicProviderReason(error)): string {
  if (error.status === 504) {
    return `I could not complete the model call before my safety deadline for this round. Reason: ${detail}. I am returning this explicit timeout notice so the debate transcript remains well-formed rather than failing the LQ request.`;
  }

  return `I could not complete the upstream model call for this round. Reason: ${detail}. I am returning this explicit provider-failure notice so the debate transcript remains well-formed rather than failing the LQ request.`;
}

function providerFailureDiagnostic(error: ProviderError): ProviderFailureDiagnostic {
  const detail = publicProviderReason(error);
  if (error.status !== undefined) {
    return { kind: "provider_error", detail, status: error.status };
  }
  return { kind: "provider_error", detail };
}

function publicProviderReason(error: ProviderError): string {
  const statusPrefix = error.status !== undefined ? `status ${error.status}; ` : "";
  const message = error.message.trim() || "provider failed without a detailed message";
  return truncateProviderReason(`${statusPrefix}${redactSecretLikeValues(message)}`, 240);
}

function redactSecretLikeValues(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "sk-[redacted]")
    .replace(/xox[baprs]-[A-Za-z0-9-]{20,}/g, "xox[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, "gh[redacted]")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA[redacted]")
    .replace(/lqbot_[A-Za-z0-9_-]{32,}/g, "lqbot_[redacted]");
}

function truncateProviderReason(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}
