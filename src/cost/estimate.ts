import { getPricing } from "./pricing";

export interface CostEstimateInput {
  model: string;
  inputText: string;
  outputText?: string;
  maxOutputTokens: number;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateReservedCost(input: CostEstimateInput): CostEstimate {
  const inputTokens = estimateTokens(input.inputText);
  const outputTokens = input.maxOutputTokens;
  return price(input.model, inputTokens, outputTokens);
}

export function estimateActualCost(input: CostEstimateInput): CostEstimate {
  const inputTokens = estimateTokens(input.inputText);
  const outputTokens = estimateTokens(input.outputText ?? "");
  return price(input.model, inputTokens, outputTokens);
}

export function estimateCostFromTokens(
  model: string,
  inputTokens: number,
  outputTokens: number,
): CostEstimate {
  return price(model, inputTokens, outputTokens);
}

function price(model: string, inputTokens: number, outputTokens: number): CostEstimate {
  const pricing = getPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputUsdPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  return {
    inputTokens,
    outputTokens,
    estimatedUsd: roundUsd(inputCost + outputCost),
  };
}

export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
