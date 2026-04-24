import { z } from "zod";

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
    round: z.number().int().min(0).max(4),
    role: LqRoleSchema,
    context: z.array(z.unknown()),
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

export class RequestBodyError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

export async function readLqRequest(request: Request, maxBodyBytes: number): Promise<LqRequest> {
  if (request.method !== "POST") {
    throw new RequestBodyError("method_not_allowed", 405);
  }

  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > maxBodyBytes) {
    throw new RequestBodyError("payload_too_large", 413);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maxBodyBytes) {
    throw new RequestBodyError("payload_too_large", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RequestBodyError("invalid_json", 400);
  }

  const result = LqRequestSchema.safeParse(parsed);
  if (!result.success) {
    throw new RequestBodyError("invalid_lq_request", 400);
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
