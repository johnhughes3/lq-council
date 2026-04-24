import type { Env } from "../types";
import { type ModelRequest, type ModelResult, ProviderError, withTimeout } from "./types";

interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

interface OpenAiCompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export async function runOpenAiCompatible(
  request: ModelRequest,
  options = optionsFromEnv(request.env, request.model),
): Promise<ModelResult> {
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const response = await withTimeout(
    fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
        ...options.extraHeaders,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: request.messages.system },
          { role: "user", content: request.messages.user },
        ],
        max_tokens: request.maxOutputTokens,
      }),
    }),
    request.timeoutMs,
    () => controller.abort(),
  );

  const body = (await response.json().catch(() => null)) as OpenAiCompatibleResponse | null;
  if (!response.ok) {
    throw new ProviderError(
      body?.error?.message ?? `Provider returned ${response.status}`,
      response.status,
    );
  }

  const content = body?.choices?.[0]?.message?.content;
  const text = normalizeContent(content);
  if (!text) {
    throw new ProviderError("OpenAI-compatible provider returned an empty response");
  }

  const usage = usageFrom(body);
  return usage ? { text, usage } : { text };
}

export function optionsFromEnv(env: Env, model: string): OpenAiCompatibleOptions {
  const baseUrl = env.OPENAI_BASE_URL;
  const apiKey = env.OPENAI_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new ProviderError("OPENAI_BASE_URL and OPENAI_API_KEY are required");
  }

  return {
    baseUrl,
    apiKey,
    model: env.OPENAI_MODEL ?? model,
  };
}

function normalizeContent(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" || !part.type ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return null;
}

function usageFrom(response: OpenAiCompatibleResponse | null): ModelResult["usage"] {
  const inputTokens = response?.usage?.prompt_tokens ?? response?.usage?.input_tokens;
  const outputTokens = response?.usage?.completion_tokens ?? response?.usage?.output_tokens;
  const usage: NonNullable<ModelResult["usage"]> = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
}
