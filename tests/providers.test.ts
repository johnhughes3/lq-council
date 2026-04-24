import { afterEach, describe, expect, it, vi } from "vitest";
import { runConfiguredModel } from "../src/providers";
import { runCloudflareWorkersAi } from "../src/providers/cloudflare-workers-ai";
import { runOpenAiCompatible } from "../src/providers/openai-compatible";
import { runVercelAiGateway } from "../src/providers/vercel-ai-gateway";
import type { Env } from "../src/types";

const messages = { system: "system", user: "user" };

describe("providers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls Cloudflare Workers AI binding", async () => {
    const env: Env = {
      AI: {
        run: vi.fn(async () => ({
          response: "answer",
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        })),
      } as unknown as Ai,
    };

    const result = await runCloudflareWorkersAi({
      env,
      model: "@cf/moonshotai/kimi-k2.6",
      messages,
      maxOutputTokens: 100,
      timeoutMs: 1000,
    });

    expect(result.text).toBe("answer");
    expect(result.usage?.inputTokens).toBe(10);
  });

  it("rejects missing Cloudflare Workers AI binding and empty responses", async () => {
    await expect(
      runCloudflareWorkersAi({
        env: {},
        model: "@cf/moonshotai/kimi-k2.6",
        messages,
        maxOutputTokens: 100,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("binding is not configured");

    await expect(
      runCloudflareWorkersAi({
        env: { AI: { run: vi.fn(async () => ({})) } as unknown as Ai },
        model: "@cf/moonshotai/kimi-k2.6",
        messages,
        maxOutputTokens: 100,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("empty response");
  });

  it("extracts Cloudflare Workers AI fallback response shapes and usage fields", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        result: { response: "result response" },
        usage: { input_tokens: 11, output_tokens: 6 },
      })
      .mockResolvedValueOnce({ result: { text: "result text" } })
      .mockResolvedValueOnce({ choices: [{ message: { content: "choice message" } }] })
      .mockResolvedValueOnce({ choices: [{ text: "choice text" }] });
    const env: Env = { AI: { run } as unknown as Ai };
    const request = {
      env,
      model: "@cf/moonshotai/kimi-k2.6",
      messages,
      maxOutputTokens: 100,
      timeoutMs: 1000,
    };

    await expect(runCloudflareWorkersAi(request)).resolves.toMatchObject({
      text: "result response",
      usage: { inputTokens: 11, outputTokens: 6 },
    });
    await expect(runCloudflareWorkersAi(request)).resolves.toMatchObject({ text: "result text" });
    await expect(runCloudflareWorkersAi(request)).resolves.toMatchObject({
      text: "choice message",
    });
    await expect(runCloudflareWorkersAi(request)).resolves.toMatchObject({ text: "choice text" });
  });

  it("times out stalled Cloudflare Workers AI calls", async () => {
    await expect(
      runCloudflareWorkersAi({
        env: { AI: { run: vi.fn(() => new Promise(() => undefined)) } as unknown as Ai },
        model: "@cf/moonshotai/kimi-k2.6",
        messages,
        maxOutputTokens: 100,
        timeoutMs: 1,
      }),
    ).rejects.toThrow("timed out");
  });

  it("calls an OpenAI-compatible provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: "provider answer" } }],
          usage: { prompt_tokens: 4, completion_tokens: 3 },
        }),
      ),
    );

    const result = await runOpenAiCompatible({
      env: {
        OPENAI_BASE_URL: "https://example.test/v1",
        OPENAI_API_KEY: "test",
        OPENAI_MODEL: "kimi-k2.6",
      },
      model: "kimi-k2.6",
      messages,
      maxOutputTokens: 100,
      timeoutMs: 1000,
    });

    expect(result.text).toBe("provider answer");
    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("handles OpenAI-compatible content arrays and provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            choices: [{ message: { content: [{ type: "text", text: "array answer" }] } }],
          }),
        )
        .mockResolvedValueOnce(Response.json({ error: { message: "bad key" } }, { status: 401 })),
    );

    await expect(
      runOpenAiCompatible({
        env: {
          OPENAI_BASE_URL: "https://example.test/v1",
          OPENAI_API_KEY: "test",
        },
        model: "kimi-k2.6",
        messages,
        maxOutputTokens: 100,
        timeoutMs: 1000,
      }),
    ).resolves.toMatchObject({ text: "array answer" });

    await expect(
      runOpenAiCompatible({
        env: {
          OPENAI_BASE_URL: "https://example.test/v1",
          OPENAI_API_KEY: "test",
        },
        model: "kimi-k2.6",
        messages,
        maxOutputTokens: 100,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("bad key");
  });

  it("handles OpenAI-compatible fallback errors, empty responses, and alternate usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            choices: [
              {
                message: {
                  content: [
                    { text: "implicit text" },
                    { type: "image", text: "ignored" },
                    { type: "text", text: "explicit text" },
                  ],
                },
              },
            ],
            usage: { input_tokens: 8, output_tokens: 9 },
          }),
        )
        .mockResolvedValueOnce(new Response("not json", { status: 429 }))
        .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: [] } }] }))
        .mockResolvedValueOnce(Response.json({ choices: [{}] })),
    );
    const request = {
      env: {
        OPENAI_BASE_URL: "https://example.test/v1/",
        OPENAI_API_KEY: "test",
      },
      model: "kimi-k2.6",
      messages,
      maxOutputTokens: 100,
      timeoutMs: 1000,
    };

    await expect(runOpenAiCompatible(request)).resolves.toMatchObject({
      text: "implicit text\nexplicit text",
      usage: { inputTokens: 8, outputTokens: 9 },
    });
    await expect(runOpenAiCompatible(request)).rejects.toThrow("Provider returned 429");
    await expect(runOpenAiCompatible(request)).rejects.toThrow("empty response");
    await expect(runOpenAiCompatible(request)).rejects.toThrow("empty response");
  });

  it("requires OpenAI-compatible credentials", async () => {
    await expect(
      runOpenAiCompatible({
        env: {},
        model: "kimi-k2.6",
        messages,
        maxOutputTokens: 100,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("OPENAI_BASE_URL");
  });

  it("times out stalled OpenAI-compatible calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );

    await expect(
      runOpenAiCompatible({
        env: {
          OPENAI_BASE_URL: "https://example.test/v1",
          OPENAI_API_KEY: "test",
        },
        model: "kimi-k2.6",
        messages,
        maxOutputTokens: 100,
        timeoutMs: 1,
      }),
    ).rejects.toThrow("timed out");
  });

  it("maps Vercel AI Gateway credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: "vercel answer" } }],
        }),
      ),
    );

    const result = await runVercelAiGateway({
      env: { VERCEL_AI_GATEWAY_API_KEY: "test" },
      model: "@cf/moonshotai/kimi-k2.6",
      messages,
      maxOutputTokens: 100,
      timeoutMs: 1000,
    });

    expect(result.text).toBe("vercel answer");
    const body = JSON.parse(
      String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body),
    );
    expect(body.model).toBe("moonshotai/kimi-k2.6");
  });

  it("maps Vercel AI Gateway fallback credentials without rewriting non-Cloudflare models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: "fallback vercel answer" } }],
        }),
      ),
    );

    const result = await runVercelAiGateway({
      env: { AI_GATEWAY_API_KEY: "test" },
      model: "moonshotai/kimi-k2.6",
      messages,
      maxOutputTokens: 100,
      timeoutMs: 1000,
    });

    expect(result.text).toBe("fallback vercel answer");
    const body = JSON.parse(
      String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body),
    );
    expect(body.model).toBe("moonshotai/kimi-k2.6");
  });

  it("requires Vercel AI Gateway credentials", async () => {
    await expect(
      runVercelAiGateway({
        env: {},
        model: "moonshotai/kimi-k2.6",
        messages,
        maxOutputTokens: 100,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("VERCEL_AI_GATEWAY_API_KEY");
  });

  it("selects provider adapters from agent config", async () => {
    const env: Env = {
      AI: { run: vi.fn(async () => ({ response: "configured answer" })) } as unknown as Ai,
    };

    const result = await runConfiguredModel(
      env,
      {
        id: "x",
        displayName: "X",
        provider: "cloudflare-workers-ai",
        model: "@cf/moonshotai/kimi-k2.6",
        maxOutputTokens: 100,
        monthlyBudgetUsd: 1,
        files: [],
        security: { maxBodyBytes: 1000, allowRemoteMcp: false, maxToolCallsPerRound: 0 },
      },
      messages,
    );

    expect(result.text).toBe("configured answer");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ choices: [{ message: { content: "openai configured" } }] }),
        )
        .mockResolvedValueOnce(
          Response.json({ choices: [{ message: { content: "vercel configured" } }] }),
        ),
    );

    await expect(
      runConfiguredModel(
        {
          OPENAI_BASE_URL: "https://example.test/v1",
          OPENAI_API_KEY: "test",
          MODEL_TIMEOUT_MS: "invalid",
        },
        {
          id: "x",
          displayName: "X",
          provider: "openai-compatible",
          model: "kimi-k2.6",
          maxOutputTokens: 100,
          monthlyBudgetUsd: 1,
          files: [],
          security: { maxBodyBytes: 1000, allowRemoteMcp: false, maxToolCallsPerRound: 0 },
        },
        messages,
      ),
    ).resolves.toMatchObject({ text: "openai configured" });

    await expect(
      runConfiguredModel(
        {
          VERCEL_AI_GATEWAY_API_KEY: "test",
          MODEL_TIMEOUT_MS: "60000",
        },
        {
          id: "x",
          displayName: "X",
          provider: "vercel-ai-gateway",
          model: "moonshotai/kimi-k2.6",
          maxOutputTokens: 100,
          monthlyBudgetUsd: 1,
          files: [],
          security: { maxBodyBytes: 1000, allowRemoteMcp: false, maxToolCallsPerRound: 0 },
        },
        messages,
      ),
    ).resolves.toMatchObject({ text: "vercel configured" });
  });
});
