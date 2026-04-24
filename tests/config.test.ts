import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("deployment config", () => {
  it("persists Cloudflare Workers Logs with full sampling", async () => {
    const wrangler = JSON.parse(await readFile("wrangler.jsonc", "utf8")) as {
      observability?: {
        enabled?: unknown;
        head_sampling_rate?: unknown;
      };
      vars?: Record<string, unknown>;
    };

    expect(wrangler.observability).toEqual({
      enabled: true,
      head_sampling_rate: 1,
    });
    expect(wrangler.vars).toEqual(
      expect.objectContaining({
        MODEL_CONTEXT_TOKENS: "262144",
        MODEL_TIMEOUT_MS: "270000",
      }),
    );
  });
});
