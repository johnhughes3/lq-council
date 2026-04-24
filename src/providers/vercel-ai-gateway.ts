import { runOpenAiCompatible } from "./openai-compatible";
import { type ModelRequest, type ModelResult, ProviderError } from "./types";

const VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

export async function runVercelAiGateway(request: ModelRequest): Promise<ModelResult> {
  const apiKey = request.env.VERCEL_AI_GATEWAY_API_KEY ?? request.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new ProviderError("VERCEL_AI_GATEWAY_API_KEY is required");
  }

  return runOpenAiCompatible(request, {
    baseUrl: VERCEL_AI_GATEWAY_BASE_URL,
    apiKey,
    model: request.model === "@cf/moonshotai/kimi-k2.6" ? "moonshotai/kimi-k2.6" : request.model,
  });
}
