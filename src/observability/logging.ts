import type { LqRequest, RequestBodyDiagnostic } from "../contract/lq";
import type { ContextBudgetCheck } from "../providers/context-budget";
import type { ProviderEvent } from "../providers/types";
import type { AgentDefinition, DebateMessages, Env } from "../types";

export interface RequestLogContext {
  requestId: string;
  method: string;
  path: string;
  agentId?: string;
  requestedAgentId?: string;
  contentType: string | null;
  contentLengthHeader: string | null;
  userAgent: string | null;
  cfRay: string | null;
  authorization: {
    present: boolean;
    scheme: string | null;
  };
}

export function publicDebatePayloadLoggingEnabled(env: Env): boolean {
  return env.LOG_PUBLIC_DEBATE_PAYLOADS === "true" || env.LOG_PUBLIC_DEBATE_PAYLOADS === "1";
}

export function logRequestAccepted(
  context: RequestLogContext,
  elapsedMs: number,
  agent: AgentDefinition,
  body: LqRequest,
  includePublicPayload: boolean,
): void {
  console.log("lq_request_accepted", {
    request: context,
    status: 200,
    elapsedMs,
    model: {
      provider: agent.provider,
      name: agent.model,
      maxOutputTokens: agent.maxOutputTokens,
    },
    input: requestInputDiagnostic(body, includePublicPayload),
  });
}

export function buildRequestLogContext(
  request: Request,
  requestId: string,
  requestedAgentId: string | undefined,
): RequestLogContext {
  const url = new URL(request.url);
  const authorization = request.headers.get("authorization");
  const context: RequestLogContext = {
    requestId,
    method: request.method,
    path: url.pathname,
    contentType: request.headers.get("content-type"),
    contentLengthHeader: request.headers.get("content-length"),
    userAgent: truncateNullable(request.headers.get("user-agent"), 120),
    cfRay: request.headers.get("cf-ray"),
    authorization: {
      present: authorization !== null,
      scheme: authorizationScheme(authorization),
    },
  };
  if (requestedAgentId !== undefined) {
    context.requestedAgentId = requestedAgentId;
  }
  return context;
}

export function withAgentId(context: RequestLogContext, agentId: string): RequestLogContext {
  return { ...context, agentId };
}

export function logRequestRejected(
  context: RequestLogContext,
  status: number,
  error: string,
  elapsedMs: number,
  diagnostic?: RequestBodyDiagnostic,
): void {
  console.warn("lq_request_rejected", {
    request: context,
    status,
    error,
    elapsedMs,
    diagnostic,
  });
}

export function logRequestFailed(
  context: RequestLogContext,
  status: number,
  error: unknown,
  elapsedMs: number,
): void {
  console.error("lq_request_failed", {
    request: context,
    status,
    elapsedMs,
    error: sanitizeError(error),
  });
}

export function logProviderEvent(context: RequestLogContext, event: ProviderEvent): void {
  const payload = {
    request: context,
    provider: {
      ...event,
      ...(event.type === "attempt_failed" ? { error: sanitizeError(event.error) } : {}),
    },
  };

  switch (event.type) {
    case "attempt_failed":
      console.error("lq_provider_attempt_failed", payload);
      return;
    case "empty_response":
      console.warn("lq_provider_empty_response", payload);
      return;
    case "attempt_completed":
      console.log("lq_provider_attempt_completed", payload);
      return;
    case "attempt_started":
      console.log("lq_provider_attempt_started", payload);
      return;
  }
}

export function logModelInputPrepared(
  context: RequestLogContext,
  elapsedMs: number,
  agent: AgentDefinition,
  messages: DebateMessages,
  includePublicPayload: boolean,
  canary: string,
): void {
  console.log("lq_model_input_prepared", {
    request: context,
    status: 200,
    elapsedMs,
    model: {
      provider: agent.provider,
      name: agent.model,
      maxOutputTokens: agent.maxOutputTokens,
    },
    input: {
      systemChars: messages.system.length,
      userChars: messages.user.length,
      ...(includePublicPayload
        ? {
            messages: {
              system: redactCanary(messages.system, canary),
              user: redactCanary(messages.user, canary),
            },
          }
        : {}),
    },
  });
}

export function logSpendCapReached(
  context: RequestLogContext,
  elapsedMs: number,
  estimatedUsd: number,
  monthlyLimitUsd: number,
): void {
  console.warn("lq_spend_cap_reached", {
    request: context,
    status: 200,
    elapsedMs,
    estimatedUsd,
    monthlyLimitUsd,
  });
}

export function logContextBudgetExceeded(
  context: RequestLogContext,
  elapsedMs: number,
  budget: ContextBudgetCheck,
): void {
  console.warn("lq_context_budget_exceeded", {
    request: context,
    status: 200,
    elapsedMs,
    budget,
  });
}

export function logRequestCompleted(
  context: RequestLogContext,
  elapsedMs: number,
  textChars: number,
  outputText?: string,
): void {
  console.log("lq_request_completed", {
    request: context,
    status: 200,
    elapsedMs,
    response: {
      keys: ["text"],
      textChars,
      ...(outputText !== undefined ? { text: outputText } : {}),
    },
  });
}

function authorizationScheme(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^([A-Za-z][A-Za-z0-9._~-]*)\s+/);
  return match?.[1]?.toLowerCase() ?? "unknown";
}

function requestInputDiagnostic(
  body: LqRequest,
  includePublicPayload: boolean,
): Record<string, unknown> {
  return {
    sessionIdChars: body.session_id.length,
    round: body.round,
    role: body.role,
    promptChars: body.prompt.length,
    contextItems: body.context.length,
    keys: Object.keys(body).sort(),
    ...(includePublicPayload ? { payload: body } : {}),
  };
}

function sanitizeError(error: unknown): { name: string; message: string; status?: number } {
  if (!(error instanceof Error)) {
    return { name: "UnknownError", message: "Unknown request failure" };
  }
  const base = {
    name: error.name,
    message: truncate(redactSecretLikeValues(error.message), 240),
  };
  const status = statusFrom(error);
  if (status !== undefined) return { ...base, status };
  return {
    ...base,
  };
}

function statusFrom(error: Error): number | undefined {
  if (!("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
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

function redactCanary(value: string, canary: string): string {
  return value.replaceAll(canary, "[redacted-security-marker]");
}

function truncateNullable(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  return truncate(value, maxLength);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}
