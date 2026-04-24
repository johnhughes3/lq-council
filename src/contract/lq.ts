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

export interface LqResponse {
  text: string;
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

export function buildLqResponse(_request: LqRequest, responseText: string): LqResponse {
  return { text: responseText };
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
