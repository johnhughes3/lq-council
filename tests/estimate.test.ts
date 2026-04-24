import { describe, expect, it } from "vitest";
import {
  estimateActualCost,
  estimateCostFromTokens,
  estimateReservedCost,
  estimateTokens,
} from "../src/cost/estimate";
import { getPricing } from "../src/cost/pricing";

describe("cost estimates", () => {
  it("estimates tokens conservatively from characters", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(1);
  });

  it("uses Kimi K2.6 pricing for reservations and actuals", () => {
    const reserved = estimateReservedCost({
      model: "@cf/moonshotai/kimi-k2.6",
      inputText: "x".repeat(4000),
      maxOutputTokens: 1000,
    });
    const actual = estimateActualCost({
      model: "@cf/moonshotai/kimi-k2.6",
      inputText: "x".repeat(4000),
      outputText: "y".repeat(400),
      maxOutputTokens: 1000,
    });
    expect(reserved.estimatedUsd).toBeGreaterThan(actual.estimatedUsd);
  });

  it("falls back for unknown models", () => {
    expect(getPricing("unknown/model").outputUsdPerMillion).toBe(5);
  });

  it("prices provider-reported token usage", () => {
    const estimate = estimateCostFromTokens("kimi-k2.6", 1_000_000, 1_000_000);
    expect(estimate.estimatedUsd).toBe(4.95);
  });
});
