export type {
  AgentDefinition,
  AgentSecurityConfig,
  DebateMessages,
  PersonaFile,
  ProviderName,
} from "./agent-types";

import type { ProviderName } from "./agent-types";

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
