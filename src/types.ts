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

export interface Env {
  AI?: Ai;
  SPEND_LEDGER?: DurableObjectNamespace;
  AGENT_TOKEN_HASHES?: string;
  BOT_TOKEN_HASH?: string;
  LQBOT_DEFAULT_AGENT?: string;
  LQBOT_PROVIDER?: ProviderName;
  MONTHLY_BUDGET_USD?: string;
  MAX_BODY_BYTES?: string;
  MODEL_CONTEXT_TOKENS?: string;
  MODEL_TIMEOUT_MS?: string;
  LOG_PUBLIC_DEBATE_PAYLOADS?: string;
  ENVIRONMENT?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  VERCEL_AI_GATEWAY_API_KEY?: string;
  AI_GATEWAY_API_KEY?: string;
}

export interface DebateMessages {
  system: string;
  user: string;
}
