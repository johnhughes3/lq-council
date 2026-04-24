import { describe, expect, it } from "vitest";
import { AgentNotFoundError, getAgent, listAgents, validateAgentId } from "../src/agents/load";

describe("agent loader", () => {
  it("lists bundled agents and applies safe environment overrides", () => {
    const ids = listAgents().map((agent) => agent.id);
    expect(ids).toEqual(["kagan", "scalia"]);

    const agent = getAgent(undefined, {
      LQBOT_DEFAULT_AGENT: "kagan",
      LQBOT_PROVIDER: "openai-compatible",
      MONTHLY_BUDGET_USD: "12.50",
      MAX_BODY_BYTES: "2048",
    });

    expect(agent.id).toBe("kagan");
    expect(agent.provider).toBe("openai-compatible");
    expect(agent.monthlyBudgetUsd).toBe(12.5);
    expect(agent.security.maxBodyBytes).toBe(2048);
  });

  it("rejects invalid or unknown agent ids", () => {
    expect(() => validateAgentId("../secret")).toThrow(AgentNotFoundError);
    expect(() => getAgent("missing", {})).toThrow(AgentNotFoundError);
  });

  it("ignores unsafe numeric overrides", () => {
    const agent = getAgent("scalia", {
      MONTHLY_BUDGET_USD: "-1",
      MAX_BODY_BYTES: "not-a-number",
    });
    expect(agent.monthlyBudgetUsd).toBe(50);
    expect(agent.security.maxBodyBytes).toBe(100000);
  });
});
