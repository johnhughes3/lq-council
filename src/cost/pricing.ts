export interface ModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
}

const KIMI_K2_6: ModelPricing = {
  inputUsdPerMillion: 0.95,
  outputUsdPerMillion: 4,
  cachedInputUsdPerMillion: 0.16,
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "@cf/moonshotai/kimi-k2.6": KIMI_K2_6,
  "moonshotai/kimi-k2.6": KIMI_K2_6,
  "kimi-k2.6": KIMI_K2_6,
};

export const FALLBACK_PRICING: ModelPricing = {
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 5,
};

export function getPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? FALLBACK_PRICING;
}
