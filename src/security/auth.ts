import type { Env } from "../types";

const TOKEN_PREFIX = "Bearer ";

export function parseBearerToken(authorization: string | null): string | null {
  if (!authorization?.startsWith(TOKEN_PREFIX)) {
    return null;
  }
  const token = authorization.slice(TOKEN_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getTokenHashForAgent(env: Env, agentId: string): string | null {
  if (env.AGENT_TOKEN_HASHES) {
    try {
      const parsed = JSON.parse(env.AGENT_TOKEN_HASHES) as Record<string, unknown>;
      const value = parsed[agentId];
      if (typeof value === "string" && isSha256Hex(value)) {
        return value;
      }
    } catch {
      return null;
    }
  }

  if (env.BOT_TOKEN_HASH && isSha256Hex(env.BOT_TOKEN_HASH)) {
    return env.BOT_TOKEN_HASH;
  }

  return null;
}

export async function isAuthorized(
  authorization: string | null,
  expectedHash: string | null,
): Promise<boolean> {
  const token = parseBearerToken(authorization);
  if (!token || !expectedHash) {
    return false;
  }
  const actualHash = await sha256Hex(token);
  return timingSafeEqualHex(actualHash, expectedHash);
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const left = hexToBytes(a);
  const right = hexToBytes(b);
  const max = Math.max(left.length, right.length, 32);
  let diff = left.length ^ right.length;

  for (let index = 0; index < max; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return diff === 0;
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[a-f0-9]*$/i.test(value) || value.length % 2 !== 0) {
    return new Uint8Array();
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
