import { type ModelRequest, type ModelResult, ProviderError, withTimeout } from "./types";

interface WorkersAiResponse {
  response?: string;
  result?: {
    response?: string;
    text?: string;
  };
  choices?: Array<{
    message?: {
      content?: string;
    };
    text?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

const PROVIDER = "cloudflare-workers-ai";
const MAX_EMPTY_RESPONSE_ATTEMPTS = 2;

export async function runCloudflareWorkersAi(request: ModelRequest): Promise<ModelResult> {
  if (!request.env.AI) {
    throw new ProviderError("Cloudflare Workers AI binding is not configured");
  }

  const input = {
    messages: [
      { role: "system", content: request.messages.system },
      { role: "user", content: request.messages.user },
    ],
    max_tokens: request.maxOutputTokens,
    chat_template_kwargs: {
      thinking: false,
    },
  };
  const deadline = Date.now() + request.timeoutMs;

  for (let attempt = 1; attempt <= MAX_EMPTY_RESPONSE_ATTEMPTS; attempt += 1) {
    const attemptTimeoutMs = remainingTimeoutMs(deadline);
    request.onProviderEvent?.({
      type: "attempt_started",
      provider: PROVIDER,
      model: request.model,
      attempt,
      maxAttempts: MAX_EMPTY_RESPONSE_ATTEMPTS,
      totalTimeoutMs: request.timeoutMs,
      attemptTimeoutMs,
      maxOutputTokens: request.maxOutputTokens,
    });

    let response: WorkersAiResponse;
    try {
      response = (await withTimeout(
        request.env.AI.run(request.model, input),
        attemptTimeoutMs,
      )) as WorkersAiResponse;
    } catch (error) {
      request.onProviderEvent?.({
        type: "attempt_failed",
        provider: PROVIDER,
        model: request.model,
        attempt,
        maxAttempts: MAX_EMPTY_RESPONSE_ATTEMPTS,
        totalTimeoutMs: request.timeoutMs,
        attemptTimeoutMs,
        willRetry: false,
        error,
      });
      if (error instanceof ProviderError) throw error;
      const message =
        error instanceof Error ? error.message : "Cloudflare Workers AI request failed";
      throw new ProviderError(message, statusFrom(error));
    }

    const text = extractText(response);
    if (text && text.trim().length > 0) {
      const usage = usageFrom(response);
      request.onProviderEvent?.({
        type: "attempt_completed",
        provider: PROVIDER,
        model: request.model,
        attempt,
        maxAttempts: MAX_EMPTY_RESPONSE_ATTEMPTS,
        totalTimeoutMs: request.timeoutMs,
        attemptTimeoutMs,
        textChars: text.length,
        ...(usage ? { usage } : {}),
        responseShape: describeResponseShape(response),
      });
      return usage ? { text, usage } : { text };
    }

    const willRetry = attempt < MAX_EMPTY_RESPONSE_ATTEMPTS && remainingTimeoutMs(deadline) > 1;
    request.onProviderEvent?.({
      type: "empty_response",
      provider: PROVIDER,
      model: request.model,
      attempt,
      maxAttempts: MAX_EMPTY_RESPONSE_ATTEMPTS,
      totalTimeoutMs: request.timeoutMs,
      attemptTimeoutMs,
      willRetry,
      responseShape: describeResponseShape(response),
      ...(request.logPublicPayloads ? { response } : {}),
    });
    if (!willRetry) {
      throw new ProviderError(
        `Cloudflare Workers AI returned an empty response after ${attempt} ${attempt === 1 ? "attempt" : "attempts"}`,
      );
    }
  }

  throw new ProviderError("Cloudflare Workers AI returned an empty response");
}

function extractText(response: WorkersAiResponse): string | null {
  return (
    response.response ??
    response.result?.response ??
    response.result?.text ??
    response.choices?.[0]?.message?.content ??
    response.choices?.[0]?.text ??
    null
  );
}

function usageFrom(response: WorkersAiResponse): ModelResult["usage"] {
  const inputTokens = response.usage?.prompt_tokens ?? response.usage?.input_tokens;
  const outputTokens = response.usage?.completion_tokens ?? response.usage?.output_tokens;
  const usage: NonNullable<ModelResult["usage"]> = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function remainingTimeoutMs(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

function statusFrom(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}

function describeResponseShape(response: WorkersAiResponse): Record<string, unknown> {
  const firstChoice = response.choices?.[0];
  const shape: Record<string, unknown> = {
    topLevelKeys: Object.keys(response).sort(),
  };
  if (response.response !== undefined) shape.responseChars = response.response.length;
  if (response.result !== undefined) {
    shape.resultKeys = Object.keys(response.result).sort();
    if (response.result.response !== undefined) {
      shape.resultResponseChars = response.result.response.length;
    }
    if (response.result.text !== undefined) shape.resultTextChars = response.result.text.length;
  }
  if (response.choices !== undefined) {
    shape.choiceCount = response.choices.length;
    if (firstChoice !== undefined) {
      shape.firstChoiceKeys = Object.keys(firstChoice).sort();
      if (firstChoice.message !== undefined) {
        shape.firstChoiceMessageKeys = Object.keys(firstChoice.message).sort();
        shape.firstChoiceMessageContentType = typeof firstChoice.message.content;
        if (firstChoice.message.content !== undefined) {
          shape.firstChoiceMessageContentChars = firstChoice.message.content.length;
        }
      }
      if (firstChoice.text !== undefined) shape.firstChoiceTextChars = firstChoice.text.length;
    }
  }
  if (response.usage !== undefined) shape.usageKeys = Object.keys(response.usage).sort();
  return shape;
}
