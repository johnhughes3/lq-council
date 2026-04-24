import type { RequestBodyDiagnostic } from "../contract/lq";

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

export function logRequestCompleted(
  context: RequestLogContext,
  elapsedMs: number,
  textChars: number,
): void {
  console.log("lq_request_completed", {
    request: context,
    status: 200,
    elapsedMs,
    response: {
      keys: ["text"],
      textChars,
    },
  });
}

function authorizationScheme(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^([A-Za-z][A-Za-z0-9._~-]*)\s+/);
  return match?.[1]?.toLowerCase() ?? "unknown";
}

function sanitizeError(error: unknown): { name: string; message: string } {
  if (!(error instanceof Error)) {
    return { name: "UnknownError", message: "Unknown request failure" };
  }
  return {
    name: error.name,
    message: truncate(error.message, 240),
  };
}

function truncateNullable(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  return truncate(value, maxLength);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}
