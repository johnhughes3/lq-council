import type { AgentDefinition, DebateMessages, Env } from "../types";
import { runCloudflareWorkersAi } from "./cloudflare-workers-ai";
import { runOpenAiCompatible } from "./openai-compatible";
import type { ModelResult } from "./types";
import { runVercelAiGateway } from "./vercel-ai-gateway";

const DEFAULT_MODEL_TIMEOUT_MS = 270_000;
const MAX_MODEL_TIMEOUT_MS = 285_000;

export async function runConfiguredModel(
  env: Env,
  agent: AgentDefinition,
  messages: DebateMessages,
): Promise<ModelResult> {
  const request = {
    env,
    model: agent.model,
    messages,
    maxOutputTokens: agent.maxOutputTokens,
    timeoutMs: modelTimeoutMs(env),
  };

  switch (agent.provider) {
    case "cloudflare-workers-ai":
      return runCloudflareWorkersAi(request);
    case "vercel-ai-gateway":
      return runVercelAiGateway(request);
    case "openai-compatible":
      return runOpenAiCompatible(request);
  }
}

function modelTimeoutMs(env: Env): number {
  if (!env.MODEL_TIMEOUT_MS) return DEFAULT_MODEL_TIMEOUT_MS;
  const parsed = Number(env.MODEL_TIMEOUT_MS);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_MODEL_TIMEOUT_MS) {
    return DEFAULT_MODEL_TIMEOUT_MS;
  }
  return parsed;
}
