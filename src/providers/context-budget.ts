import type { AgentDefinition, Env } from "../types";

const DEFAULT_MODEL_CONTEXT_TOKENS = 262_144;
const MIN_MODEL_CONTEXT_TOKENS = 4_096;
const MAX_MODEL_CONTEXT_TOKENS = 1_000_000;
const CONTEXT_SAFETY_MARGIN_TOKENS = 4_096;

export interface ContextBudgetCheck {
  ok: boolean;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  contextTokens: number;
  safetyMarginTokens: number;
  availableInputTokens: number;
}

export function checkContextBudget(
  env: Env,
  agent: AgentDefinition,
  inputText: string,
): ContextBudgetCheck {
  const contextTokens = modelContextTokens(env);
  const estimatedInputTokens = estimateConservativeTokens(inputText);
  const availableInputTokens = Math.max(
    0,
    contextTokens - agent.maxOutputTokens - CONTEXT_SAFETY_MARGIN_TOKENS,
  );

  return {
    ok: estimatedInputTokens <= availableInputTokens,
    estimatedInputTokens,
    maxOutputTokens: agent.maxOutputTokens,
    contextTokens,
    safetyMarginTokens: CONTEXT_SAFETY_MARGIN_TOKENS,
    availableInputTokens,
  };
}

export function modelContextTokens(env: Env): number {
  if (!env.MODEL_CONTEXT_TOKENS) return DEFAULT_MODEL_CONTEXT_TOKENS;
  const parsed = Number(env.MODEL_CONTEXT_TOKENS);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_MODEL_CONTEXT_TOKENS ||
    parsed > MAX_MODEL_CONTEXT_TOKENS
  ) {
    return DEFAULT_MODEL_CONTEXT_TOKENS;
  }
  return parsed;
}

function estimateConservativeTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}
