import { describe, expect, it } from "vitest";
import {
  getTokenHashForAgent,
  isAuthorized,
  parseBearerToken,
  sha256Hex,
  timingSafeEqualHex,
} from "../src/security/auth";

describe("auth", () => {
  it("parses bearer tokens", () => {
    expect(parseBearerToken("Bearer abc")).toBe("abc");
    expect(parseBearerToken("Bearer    ")).toBeNull();
    expect(parseBearerToken("Basic abc")).toBeNull();
    expect(parseBearerToken(null)).toBeNull();
  });

  it("authorizes against sha256 token hash", async () => {
    const token = "lqbot_test_token";
    const hash = await sha256Hex(token);
    await expect(isAuthorized(`Bearer ${token}`, hash)).resolves.toBe(true);
    await expect(isAuthorized("Bearer wrong", hash)).resolves.toBe(false);
    await expect(isAuthorized(`Bearer ${token}`, null)).resolves.toBe(false);
  });

  it("loads agent-specific token hashes", async () => {
    const scalia = await sha256Hex("scalia-token");
    const env = {
      AGENT_TOKEN_HASHES: JSON.stringify({ scalia }),
    };
    expect(getTokenHashForAgent(env, "scalia")).toBe(scalia);
    expect(getTokenHashForAgent(env, "kagan")).toBeNull();
  });

  it("falls back to single BOT_TOKEN_HASH and ignores malformed mappings", async () => {
    const hash = await sha256Hex("single");
    expect(getTokenHashForAgent({ BOT_TOKEN_HASH: hash }, "any")).toBe(hash);
    expect(
      getTokenHashForAgent({ AGENT_TOKEN_HASHES: "{", BOT_TOKEN_HASH: hash }, "any"),
    ).toBeNull();
    expect(getTokenHashForAgent({ BOT_TOKEN_HASH: "not-a-hash" }, "any")).toBeNull();
  });

  it("uses timing-safe hex equality", async () => {
    const hash = await sha256Hex("same");
    expect(timingSafeEqualHex(hash, hash)).toBe(true);
    expect(timingSafeEqualHex(hash, await sha256Hex("different"))).toBe(false);
    expect(timingSafeEqualHex(hash, "not-hex")).toBe(false);
    expect(timingSafeEqualHex(hash, "abc")).toBe(false);
  });
});
