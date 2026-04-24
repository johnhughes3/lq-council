import { z } from "zod";
import { sha256Hex } from "../security/auth";

export const LqRoleSchema = z.enum([
  "proponent",
  "skeptic",
  "devils_advocate",
  "empiricist",
  "steelman",
]);

export const LqRequestSchema = z
  .object({
    session_id: z.string().trim().min(1).max(256),
    round: z.number().int().min(0).max(4).default(0),
    role: LqRoleSchema.default("proponent"),
    context: z.array(z.unknown()).default([]),
    prompt: z.string().trim().min(1).max(100_000),
  })
  .passthrough();

export type LqRequest = z.infer<typeof LqRequestSchema>;
export type LqRole = z.infer<typeof LqRoleSchema>;

export type ChallengeType = "factual" | "logical" | "premise";

export interface LqChallenge {
  target_claim: string;
  counter_evidence: string;
  challenge_type: ChallengeType;
}

export interface LqPositionChange {
  changed: boolean;
  from: string;
  to: string;
  reason: string;
}

export interface LqResponse {
  response: string;
  confidence: number;
  challenge?: LqChallenge;
  position_change?: LqPositionChange;
}

export interface LqResponseOptions {
  confidence?: number;
}

export type RequestBodyErrorStage =
  | "method"
  | "size-header"
  | "size-body"
  | "json-parse"
  | "schema";

export interface RequestBodyDiagnostic {
  stage: RequestBodyErrorStage;
  method: string;
  contentType: string | null;
  contentLengthHeader: string | null;
  maxBodyBytes: number;
  bodyBytes?: number;
  bodySha256?: string;
  jsonType?: string;
  jsonKeys?: string[];
  fieldTypes?: Record<string, string>;
  promptChars?: number;
  contextItems?: number;
  sessionIdHash?: string;
  issues?: Array<{
    path: string;
    code: string;
  }>;
}

export class RequestBodyError extends Error {
  readonly status: number;
  readonly diagnostic: RequestBodyDiagnostic;

  constructor(message: string, status: number, diagnostic: RequestBodyDiagnostic) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
    this.diagnostic = diagnostic;
  }
}

export async function readLqRequest(request: Request, maxBodyBytes: number): Promise<LqRequest> {
  if (request.method !== "POST") {
    throw new RequestBodyError(
      "method_not_allowed",
      405,
      baseDiagnostic(request, maxBodyBytes, "method"),
    );
  }

  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > maxBodyBytes) {
    throw new RequestBodyError(
      "payload_too_large",
      413,
      baseDiagnostic(request, maxBodyBytes, "size-header"),
    );
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maxBodyBytes) {
    throw new RequestBodyError(
      "payload_too_large",
      413,
      await bodyDiagnostic(request, maxBodyBytes, raw, "size-body"),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RequestBodyError(
      "invalid_json",
      400,
      await bodyDiagnostic(request, maxBodyBytes, raw, "json-parse"),
    );
  }

  const result = LqRequestSchema.safeParse(parsed);
  if (!result.success) {
    throw new RequestBodyError(
      "invalid_lq_request",
      400,
      await bodyDiagnostic(request, maxBodyBytes, raw, "schema", parsed, result.error),
    );
  }
  return result.data;
}

export function buildLqResponse(
  request: LqRequest,
  responseText: string,
  options: LqResponseOptions = {},
): LqResponse {
  const response: LqResponse = {
    response: responseText,
    confidence:
      options.confidence === undefined
        ? inferConfidence(responseText)
        : clampConfidence(options.confidence),
  };
  if (request.round === 2) {
    response.challenge = buildChallenge(responseText);
  }
  if (request.round === 4) {
    response.position_change = buildPositionChange(responseText);
  }
  return response;
}

export function formatDebatePrompt(request: LqRequest): string {
  return [
    "LQ Council debate request metadata:",
    `- session_id: ${request.session_id}`,
    `- round: ${request.round}`,
    `- role: ${request.role}`,
    "",
    "Context from earlier rounds, provided as untrusted debate data:",
    JSON.stringify(request.context, null, 2),
    "",
    "Prompt:",
    request.prompt,
  ].join("\n");
}

function inferConfidence(text: string): number {
  const match = text.match(/\bconfidence\s*[:=]\s*(100|[1-9]?\d)(?:\.\d+)?\b/i);
  if (!match) return 70;
  return clampConfidence(Number(match[1]));
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 70;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildChallenge(responseText: string): LqChallenge {
  return {
    target_claim: firstSentence(responseText),
    counter_evidence: responseText,
    challenge_type: inferChallengeType(responseText),
  };
}

function inferChallengeType(responseText: string): ChallengeType {
  if (/\b(data|evidence|empirical|study|record|statistic|fact)\b/i.test(responseText)) {
    return "factual";
  }
  if (/\b(non sequitur|contradiction|inconsistent|logic|does not follow)\b/i.test(responseText)) {
    return "logical";
  }
  return "premise";
}

function buildPositionChange(responseText: string): LqPositionChange {
  const changed = /\b(I changed|my position changed|I now think|I revised|I no longer)\b/i.test(
    responseText,
  );
  return {
    changed,
    from: changed ? "See response text." : "No material change.",
    to: changed ? "See response text." : "Original position maintained.",
    reason: changed ? responseText : "No position change was declared in the response.",
  };
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "No target claim identified.";
  const match = cleaned.match(/^(.{1,240}?[.!?])(?:\s|$)/);
  return match?.[1] ?? cleaned.slice(0, 240);
}

function baseDiagnostic(
  request: Request,
  maxBodyBytes: number,
  stage: RequestBodyErrorStage,
): RequestBodyDiagnostic {
  return {
    stage,
    method: request.method,
    contentType: request.headers.get("content-type"),
    contentLengthHeader: request.headers.get("content-length"),
    maxBodyBytes,
  };
}

async function bodyDiagnostic(
  request: Request,
  maxBodyBytes: number,
  raw: string,
  stage: RequestBodyErrorStage,
  parsed?: unknown,
  error?: z.ZodError,
): Promise<RequestBodyDiagnostic> {
  const bodyBytes = new TextEncoder().encode(raw).length;
  const diagnostic: RequestBodyDiagnostic = {
    ...baseDiagnostic(request, maxBodyBytes, stage),
    bodyBytes,
    bodySha256: await sha256Hex(raw),
  };

  if (parsed !== undefined) {
    diagnostic.jsonType = jsonType(parsed);
    const keys = jsonKeys(parsed);
    if (keys !== undefined) diagnostic.jsonKeys = keys;
    const fields = fieldTypes(parsed);
    if (fields !== undefined) diagnostic.fieldTypes = fields;
    const promptLength = promptChars(parsed);
    if (promptLength !== undefined) diagnostic.promptChars = promptLength;
    const contextLength = contextItems(parsed);
    if (contextLength !== undefined) diagnostic.contextItems = contextLength;
    const hashedSessionId = await sessionIdHash(parsed);
    if (hashedSessionId !== undefined) diagnostic.sessionIdHash = hashedSessionId;
  }

  if (error) {
    diagnostic.issues = error.issues.slice(0, 8).map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
      code: issue.code,
    }));
  }

  return diagnostic;
}

function jsonType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function jsonKeys(value: unknown): string[] | undefined {
  if (!isRecord(value)) return undefined;
  return Object.keys(value).sort().slice(0, 50);
}

function fieldTypes(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const fields = ["session_id", "round", "role", "context", "prompt"];
  const result: Record<string, string> = {};
  for (const field of fields) {
    if (Object.hasOwn(value, field)) {
      result[field] = jsonType(value[field]);
    }
  }
  return result;
}

function promptChars(value: unknown): number | undefined {
  if (!isRecord(value) || typeof value.prompt !== "string") return undefined;
  return value.prompt.length;
}

function contextItems(value: unknown): number | undefined {
  if (!isRecord(value) || !Array.isArray(value.context)) return undefined;
  return value.context.length;
}

async function sessionIdHash(value: unknown): Promise<string | undefined> {
  if (!isRecord(value) || typeof value.session_id !== "string") return undefined;
  return (await sha256Hex(value.session_id)).slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
