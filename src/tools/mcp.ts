import type { RemoteMcpServerConfig } from "./registry";

const MAX_MCP_RESPONSE_BYTES = 65_536;

export class McpSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpSecurityError";
  }
}

export async function callRemoteMcpTool(
  server: RemoteMcpServerConfig,
  toolName: string,
  input: Record<string, unknown>,
  bearerToken?: string,
): Promise<unknown> {
  validateRemoteMcpServer(server, toolName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), server.timeoutMs);
  try {
    const response = await fetch(server.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: input,
        },
      }),
    });

    if (!response.ok) {
      throw new McpSecurityError(`Remote MCP server returned ${response.status}`);
    }
    const raw = await readBoundedText(response, MAX_MCP_RESPONSE_BYTES);
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new McpSecurityError("Remote MCP server returned invalid JSON");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function validateRemoteMcpServer(server: RemoteMcpServerConfig, toolName: string): void {
  const url = parseMcpUrl(server.url);
  if (url.protocol !== "https:") {
    throw new McpSecurityError("Remote MCP servers must use HTTPS");
  }
  if (url.username || url.password) {
    throw new McpSecurityError("Remote MCP URLs must not contain embedded credentials");
  }
  if (isBlockedHost(url.hostname)) {
    throw new McpSecurityError("Remote MCP host must be a public HTTPS hostname");
  }
  if (server.transport !== "streamable-http") {
    throw new McpSecurityError("Only streamable-http MCP transport is supported in production");
  }
  if (server.readonly !== true) {
    throw new McpSecurityError("MCP tools must be read-only by default");
  }
  if (!server.allowedTools.includes(toolName)) {
    throw new McpSecurityError(`Tool is not allowlisted: ${toolName}`);
  }
  if (!Number.isInteger(server.timeoutMs) || server.timeoutMs < 1 || server.timeoutMs > 10_000) {
    throw new McpSecurityError("MCP timeout must be between 1 and 10000 ms");
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new McpSecurityError("Remote MCP response exceeded the maximum size");
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new McpSecurityError("Remote MCP response exceeded the maximum size");
    }
    chunks.push(value);
  }

  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

function parseMcpUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new McpSecurityError("Remote MCP URL is invalid");
  }
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
  if (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  if (isBlockedIpv4(host)) return true;
  return isBlockedIpv6(host);
}

function isBlockedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });
  if (octets.some(Number.isNaN)) return false;
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isBlockedIpv6(host: string): boolean {
  if (!host.includes(":")) return false;
  if (host.startsWith("::ffff:")) return true;
  return (
    host === "::" ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  );
}
