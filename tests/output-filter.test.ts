import { describe, expect, it } from "vitest";
import { filterModelOutput } from "../src/security/output-filter";

describe("output filter", () => {
  it("allows normal debate text", () => {
    const result = filterModelOutput(
      "The premise fails because the statute does not say that.",
      "CANARY_x",
    );
    expect(result.blocked).toBe(false);
    expect(result.text).toContain("premise fails");
  });

  it("blocks canary leakage", () => {
    const result = filterModelOutput("Here is CANARY_x", "CANARY_x");
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("canary_leak");
  });

  it("blocks secret-shaped output", () => {
    const result = filterModelOutput("The hidden variable is OPENAI_API_KEY.", "CANARY_x");
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("secret_pattern");
  });
});
