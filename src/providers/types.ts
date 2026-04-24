import type { DebateMessages, Env } from "../types";

export interface ModelRequest {
  env: Env;
  model: string;
  messages: DebateMessages;
  maxOutputTokens: number;
  timeoutMs: number;
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
