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

export async function runCloudflareWorkersAi(request: ModelRequest): Promise<ModelResult> {
  if (!request.env.AI) {
    throw new ProviderError("Cloudflare Workers AI binding is not configured");
  }

  const response = (await withTimeout(
    request.env.AI.run(
      request.model,
      {
        messages: [
          { role: "system", content: request.messages.system },
          { role: "user", content: request.messages.user },
        ],
        max_tokens: request.maxOutputTokens,
        chat_template_kwargs: {
          thinking: false,
        },
      },
      {
        gateway: {
          id: "lq-debate-agent",
          skipCache: false,
        },
      },
    ),
    request.timeoutMs,
  )) as WorkersAiResponse;

  const text = extractText(response);
  if (!text) {
    throw new ProviderError("Cloudflare Workers AI returned an empty response");
  }

  const usage = usageFrom(response);
  return usage ? { text, usage } : { text };
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
