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
import { buildDebateMessages } from "./prompt/build-system";
import { runConfiguredModel } from "./providers";
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
      "POST /debate or /agents/:agentId/debate with { session_id, round, role, context, prompt }, returns { response, confidence, challenge?, position_change? }",
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
  try {
    const agent = getAgent(requestedAgentId, env);
    const tokenHash = getTokenHashForAgent(env, agent.id);
    const authorized = await isAuthorized(request.headers.get("authorization"), tokenHash);
    if (!authorized) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await readLqRequest(request, agent.security.maxBodyBytes);
    const canary = createCanary();
    const debatePrompt = formatDebatePrompt(body);
    const messages = buildDebateMessages(agent, debatePrompt, canary);
    const inputText = `${messages.system}\n\n${messages.user}`;
    const requestId = crypto.randomUUID();
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
      const response = buildLqResponse(
        body,
        "This debater is temporarily paused because its configured monthly model budget has been reached.",
        { confidence: 0 },
      );
      return Response.json(response);
    }

    try {
      const result = await runConfiguredModel(env, agent, messages);
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

      const response = buildLqResponse(
        body,
        filtered.text,
        filtered.blocked ? { confidence: 0 } : {},
      );
      return Response.json(response);
    } catch (error) {
      await ledger.refund({ agentId: agent.id, requestId, month });
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof RequestBodyError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof AgentNotFoundError) {
    return Response.json({ error: "agent_not_found" }, { status: 404 });
  }
  if (error instanceof ProviderError) {
    logRequestError(error);
    return Response.json({ error: "provider_error" }, { status: 502 });
  }
  if (error instanceof CostLedgerUnavailableError) {
    logRequestError(error);
    return Response.json({ error: "cost_ledger_unavailable" }, { status: 503 });
  }

  logRequestError(error);
  return Response.json({ error: "internal_error" }, { status: 500 });
}

function logRequestError(error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : "Unknown request failure";
  console.error("lq_request_failed", { name, message });
}
