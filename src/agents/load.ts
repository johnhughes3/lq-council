import { GENERATED_AGENTS } from "../generated/agents";
import type { AgentDefinition, Env } from "../types";

const AGENT_ID_RE = /^[a-z][a-z0-9-]{1,62}$/;

export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Unknown debater: ${agentId}`);
    this.name = "AgentNotFoundError";
  }
}

export function listAgents(): AgentDefinition[] {
  return Object.values(GENERATED_AGENTS).sort((a, b) => a.id.localeCompare(b.id));
}

export function validateAgentId(agentId: string): string {
  if (!AGENT_ID_RE.test(agentId)) {
    throw new AgentNotFoundError(agentId);
  }
  return agentId;
}

export function getAgent(agentId: string | undefined, env: Env): AgentDefinition {
  const defaultAgentId = env.LQBOT_DEFAULT_AGENT ?? listAgents()[0]?.id;
  const resolvedAgentId = validateAgentId(agentId ?? defaultAgentId ?? "");
  const agent = GENERATED_AGENTS[resolvedAgentId];
  if (!agent) {
    throw new AgentNotFoundError(resolvedAgentId);
  }

  const budgetOverride = parseUsd(env.MONTHLY_BUDGET_USD);
  const maxBodyOverride = parseInteger(env.MAX_BODY_BYTES);

  return {
    ...agent,
    provider: env.LQBOT_PROVIDER ?? agent.provider,
    monthlyBudgetUsd: budgetOverride ?? agent.monthlyBudgetUsd,
    security: {
      ...agent.security,
      maxBodyBytes: maxBodyOverride ?? agent.security.maxBodyBytes,
    },
  };
}

export function buildPersonaMarkdown(agent: AgentDefinition): string {
  return agent.files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `## ${file.path}\n\n${file.content.trim()}`)
    .join("\n\n---\n\n");
}

function parseUsd(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) return undefined;
  return parsed;
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) return undefined;
  return parsed;
}
