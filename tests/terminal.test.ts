import { describe, expect, it } from "vitest";
import {
  renderError,
  renderHelp,
  renderHumanOutput,
  renderStep,
  shouldUseTui,
  terminalOptions,
} from "../src/cli/terminal";

describe("terminal rendering", () => {
  it("uses styled output only for interactive human terminals", () => {
    expect(
      shouldUseTui(terminalOptions({ json: false, stdout: { isTTY: true, columns: 80 } })),
    ).toBe(true);
    expect(
      shouldUseTui(terminalOptions({ json: true, stdout: { isTTY: true, columns: 80 } })),
    ).toBe(false);
    expect(
      shouldUseTui(
        terminalOptions({ json: false, plain: true, stdout: { isTTY: true, columns: 80 } }),
      ),
    ).toBe(false);
    expect(
      shouldUseTui(
        terminalOptions({
          json: false,
          stdout: { isTTY: true, columns: 80 },
          env: { NO_TUI: "1" },
        }),
      ),
    ).toBe(false);
    expect(
      shouldUseTui(
        terminalOptions({
          json: false,
          stdout: { isTTY: true, columns: 80 },
          env: { TERM: "dumb" },
        }),
      ),
    ).toBe(false);
  });

  it("uses stable defaults for non-interactive terminals", () => {
    const options = terminalOptions({ json: false });

    expect(options.isTTY).toBe(false);
    expect(options.columns).toBe(80);
    expect(shouldUseTui(options)).toBe(false);
  });

  it("renders plain help for non-TUI output", () => {
    const output = renderHelp(
      terminalOptions({ json: false, plain: true, stdout: { isTTY: true, columns: 80 } }),
    );

    expect(output).toContain("Usage:");
    expect(output).toContain("pnpm lqbot version");
    expect(output).not.toContain("+-- lqbot ");
  });

  it("keeps plain output stable for headless users", () => {
    const output = renderHumanOutput(
      { initialized: "/tmp/bot", nextSteps: ["pnpm install", "pnpm lqbot deploy --agent scalia"] },
      terminalOptions({ json: false, plain: true, stdout: { isTTY: true, columns: 80 } }),
    );

    expect(output).toContain("initialized: /tmp/bot");
    expect(output).toContain('"pnpm install"');
  });

  it("renders every command result shape with useful titles", () => {
    const options = terminalOptions({
      json: false,
      stdout: { isTTY: true, columns: 84 },
      env: { NO_COLOR: "1" },
    });

    const cases: Array<[unknown, string]> = [
      ["plain", "+-- Result "],
      [{ synced: "scalia", deployOutput: "https://example.workers.dev" }, "+-- Sync complete "],
      [{ created: "brandeis", path: "agents/brandeis" }, "+-- Debater created "],
      [{ generated: true, agents: ["scalia", "kagan"] }, "+-- Personas generated "],
      [
        { agent: "scalia", provider: "cloudflare-workers-ai", model: "kimi", files: ["a.md"] },
        "+-- Debater valid ",
      ],
      [
        { agent: "scalia", token: "lqbot_test", tokenHash: "a".repeat(64), note: "store once" },
        "+-- Token generated ",
      ],
      [{ secret: "OPENAI_API_KEY", stored: true }, "+-- Secret stored "],
      [{ ok: true, status: 200, text: "answer" }, "+-- Smoke test "],
      [{ arbitrary: true }, "+-- Result "],
    ];

    for (const [value, expectedTitle] of cases) {
      expect(renderHumanOutput(value, options)).toContain(expectedTitle);
    }
  });

  it("renders arrays, nested objects, empty values, and scalar variants", () => {
    const options = terminalOptions({
      json: false,
      stdout: { isTTY: true, columns: 84 },
      env: { NO_COLOR: "1" },
    });

    const output = renderHumanOutput(
      {
        ok: false,
        checks: [],
        agents: ["scalia"],
        metadata: { nullValue: null, missing: undefined, enabled: true, nested: { x: 1 } },
        emptyObject: {},
      },
      options,
    );

    expect(output).toContain("Checks: (none)");
    expect(output).toContain("Ok: false");
    expect(output).toContain("1. scalia");
    expect(output).toContain("Null Value: null");
    expect(output).toContain("Missing: undefined");
    expect(output).toContain('Nested: {"x":1}');
    expect(output).toContain("Empty Object:");
  });

  it("renders help and status panels without color when NO_COLOR is set", () => {
    const options = terminalOptions({
      json: false,
      stdout: { isTTY: true, columns: 72 },
      env: { NO_COLOR: "1" },
    });

    expect(renderHelp(options)).toContain("+-- lqbot ");
    const output = renderHumanOutput({ ok: true, checks: [], agents: ["scalia"] }, options);
    expect(output).toContain("+-- Doctor ");
    expect(output).toContain("Agents:");
    expect(output).not.toContain("\x1b[");
  });

  it("renders progress steps only in TUI mode", () => {
    expect(
      renderStep(
        "Deploying Worker",
        terminalOptions({ json: false, stdout: { isTTY: true, columns: 80 } }),
      ),
    ).toContain("Deploying Worker");
    expect(
      renderStep(
        "Deploying Worker",
        terminalOptions({ json: false, plain: true, stdout: { isTTY: true, columns: 80 } }),
      ),
    ).toBeNull();
  });

  it("renders deploy and token outputs as readable panels", () => {
    const options = terminalOptions({
      json: false,
      stdout: { isTTY: true, columns: 76 },
      env: { NO_COLOR: "1" },
    });
    const output = renderHumanOutput(
      {
        deployed: true,
        agent: "scalia",
        url: "https://example.workers.dev/agents/scalia/debate",
        bearerToken: "lqbot_abcdefghijklmnopqrstuvwxyz1234567890",
        tokenHash: "a".repeat(64),
        agents: [
          {
            agent: "scalia",
            url: "https://example.workers.dev/agents/scalia/debate",
            bearerToken: "lqbot_abcdefghijklmnopqrstuvwxyz1234567890",
          },
        ],
      },
      options,
    );

    expect(output).toContain("+-- Deploy complete ");
    expect(output).toContain("Bearer Token:");
    expect(output).toContain("Agents:");
    expect(output).toContain("1. Agent: scalia");
  });

  it("renders errors with color in TUI mode and plain text otherwise", () => {
    const colored = renderError(
      "Something failed",
      terminalOptions({ json: false, stdout: { isTTY: true, columns: 80 }, env: {} }),
    );
    expect(colored).toContain("\x1b[31merror");

    const plain = renderError(
      "Something failed",
      terminalOptions({ json: false, plain: true, stdout: { isTTY: true, columns: 80 } }),
    );
    expect(plain).toBe("Something failed");
  });

  it("wraps long words inside the panel width", () => {
    const output = renderHumanOutput(
      { token: `lqbot_${"a".repeat(96)}`, tokenHash: "b".repeat(64) },
      terminalOptions({
        json: false,
        stdout: { isTTY: true, columns: 60 },
        env: { NO_COLOR: "1" },
      }),
    );

    for (const line of output.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });
});
