import { afterEach, describe, expect, it, vi } from "vitest";
import { callRemoteMcpTool, validateRemoteMcpServer } from "../src/tools/mcp";
import type { RemoteMcpServerConfig } from "../src/tools/registry";

const server: RemoteMcpServerConfig = {
  name: "research",
  transport: "streamable-http",
  url: "https://mcp.example.com/rpc",
  allowedTools: ["search"],
  readonly: true,
  timeoutMs: 1000,
};

describe("remote MCP safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows public HTTPS read-only allowlisted tools", () => {
    expect(() => validateRemoteMcpServer(server, "search")).not.toThrow();
  });

  it("rejects unsafe remote MCP endpoints and tools", () => {
    const unsafeServers: RemoteMcpServerConfig[] = [
      { ...server, url: "http://mcp.example.com/rpc" },
      { ...server, url: "not a url" },
      { ...server, url: "https://user:pass@mcp.example.com/rpc" },
      { ...server, url: "https://localhost/rpc" },
      { ...server, url: "https://127.0.0.1/rpc" },
      { ...server, url: "https://10.0.0.1/rpc" },
      { ...server, url: "https://172.16.0.1/rpc" },
      { ...server, url: "https://192.168.0.1/rpc" },
      { ...server, url: "https://169.254.169.254/rpc" },
      { ...server, url: "https://[::1]/rpc" },
      { ...server, url: "https://[::ffff:127.0.0.1]/rpc" },
      { ...server, url: "https://metadata.google.internal/rpc" },
      { ...server, readonly: false as true },
      { ...server, timeoutMs: 0 },
    ];

    for (const candidate of unsafeServers) {
      expect(() => validateRemoteMcpServer(candidate, "search")).toThrow();
    }
    expect(() => validateRemoteMcpServer(server, "write-file")).toThrow();
  });

  it("sends JSON-RPC requests with bounded JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ jsonrpc: "2.0", result: { text: "ok" } })),
    );

    const result = await callRemoteMcpTool(server, "search", { q: "agency deference" }, "token");

    expect(result).toEqual({ jsonrpc: "2.0", result: { text: "ok" } });
    expect(fetch).toHaveBeenCalledWith(
      "https://mcp.example.com/rpc",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer token" }),
      }),
    );
  });

  it("rejects remote MCP failures, invalid JSON, and oversized responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("nope", { status: 500 }))
        .mockResolvedValueOnce(new Response("not-json"))
        .mockResolvedValueOnce(new Response("x".repeat(70_000)))
        .mockResolvedValueOnce(
          new Response("{}", {
            headers: { "content-length": "70000" },
          }),
        ),
    );

    await expect(callRemoteMcpTool(server, "search", {})).rejects.toThrow("returned 500");
    await expect(callRemoteMcpTool(server, "search", {})).rejects.toThrow("invalid JSON");
    await expect(callRemoteMcpTool(server, "search", {})).rejects.toThrow("exceeded");
    await expect(callRemoteMcpTool(server, "search", {})).rejects.toThrow("exceeded");
  });
});
