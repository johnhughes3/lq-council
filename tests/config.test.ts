import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("deployment config", () => {
  it("persists Cloudflare Workers Logs with full sampling", async () => {
    const wrangler = JSON.parse(await readFile("wrangler.jsonc", "utf8")) as {
      observability?: {
        enabled?: unknown;
        head_sampling_rate?: unknown;
      };
    };

    expect(wrangler.observability).toEqual({
      enabled: true,
      head_sampling_rate: 1,
    });
  });
});
