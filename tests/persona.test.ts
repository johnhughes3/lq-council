import { describe, expect, it } from "vitest";
import { listAgents } from "../src/agents/load";

describe("bundled personas", () => {
  it("include public-safe non-impersonation language", () => {
    for (const agent of listAgents()) {
      const text = agent.files.map((file) => file.content).join("\n");
      expect(text).not.toMatch(/\bI am Justice\b/i);
      expect(text).not.toMatch(/\bendorsed by Justice\b/i);
      if (agent.id === "scalia" || agent.id === "kagan") {
        expect(text).toMatch(/You are not Justice/);
      }
    }
  });
});
