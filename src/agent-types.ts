export type ProviderName = "cloudflare-workers-ai" | "vercel-ai-gateway" | "openai-compatible";

export interface PersonaFile {
  path: string;
  content: string;
}

export interface AgentSecurityConfig {
  maxBodyBytes: number;
  allowRemoteMcp: boolean;
  maxToolCallsPerRound: number;
}

export interface AgentDefinition {
  id: string;
  displayName: string;
  provider: ProviderName;
  model: string;
  maxOutputTokens: number;
  monthlyBudgetUsd: number;
  files: PersonaFile[];
  security: AgentSecurityConfig;
}

export interface DebateMessages {
  system: string;
  user: string;
}
