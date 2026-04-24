export interface RemoteMcpServerConfig {
  name: string;
  transport: "streamable-http";
  url: string;
  authSecretName?: string;
  allowedTools: string[];
  readonly: true;
  timeoutMs: number;
}

export interface ToolRegistryConfig {
  enabled: boolean;
  maxToolCallsPerRound: number;
  servers: RemoteMcpServerConfig[];
}

export const DEFAULT_TOOL_REGISTRY: ToolRegistryConfig = {
  enabled: false,
  maxToolCallsPerRound: 0,
  servers: [],
};
