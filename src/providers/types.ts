import type { DebateMessages, Env, ProviderName } from "../types";

export type ProviderEvent =
  | ProviderAttemptStartedEvent
  | ProviderAttemptCompletedEvent
  | ProviderEmptyResponseEvent
  | ProviderAttemptFailedEvent;

interface ProviderEventBase {
  provider: ProviderName;
  model: string;
  attempt: number;
  maxAttempts: number;
  totalTimeoutMs: number;
  attemptTimeoutMs: number;
}

interface ProviderAttemptStartedEvent extends ProviderEventBase {
  type: "attempt_started";
  maxOutputTokens: number;
}

interface ProviderAttemptCompletedEvent extends ProviderEventBase {
  type: "attempt_completed";
  textChars: number;
  usage?: ModelUsage;
  responseShape?: Record<string, unknown>;
}

interface ProviderEmptyResponseEvent extends ProviderEventBase {
  type: "empty_response";
  willRetry: boolean;
  responseShape?: Record<string, unknown>;
  response?: unknown;
}

interface ProviderAttemptFailedEvent extends ProviderEventBase {
  type: "attempt_failed";
  willRetry: boolean;
  error: unknown;
}

export interface ModelRequest {
  env: Env;
  model: string;
  messages: DebateMessages;
  maxOutputTokens: number;
  timeoutMs: number;
  logPublicPayloads?: boolean;
  onProviderEvent?: (event: ProviderEvent) => void;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ModelResult {
  text: string;
  usage?: ModelUsage;
}

export class ProviderError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export function providerTimeoutError(timeoutMs: number): ProviderError {
  return new ProviderError(`Provider timed out after ${timeoutMs} ms`, 504);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          reject(providerTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
