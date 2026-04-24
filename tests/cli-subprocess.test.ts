import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface ExecResult {
  stdout: string;
  stderr: string;
}

interface ExecError extends Error {
  code?: number;
  stdout?: string;
  stderr?: string;
}

const cwd = process.cwd();
const tsx = path.join(cwd, "node_modules", ".bin", "tsx");
const cli = path.join(cwd, "scripts", "lqbot.ts");
const tempPaths: string[] = [];

afterEach(async () => {
  await rm(path.join(cwd, ".lqbot"), { recursive: true, force: true });
  await Promise.all(
    tempPaths.splice(0).map((filePath) => rm(filePath, { recursive: true, force: true })),
  );
});

describe("lqbot executable", () => {
  it("prints a version and uses exit code 2 for usage errors", async () => {
    await expect(runCli(["--version", "--plain"])).resolves.toMatchObject({
      stdout: "0.1.0\n",
    });

    await expect(runCli(["--bad-flag", "--plain"])).rejects.toMatchObject({
      code: 2,
    });
  });

  it("rejects --value for provider API key secrets", async () => {
    await expect(
      runCli(["secret", "set", "OPENAI_API_KEY", "--value", "not-a-real-key", "--plain"]),
    ).rejects.toMatchObject({
      code: 2,
    });
  });

  it("emits exactly one JSON document from deploy --json", async () => {
    const fakeBin = await makeFakePnpm();

    const result = await runCli(["deploy", "--agent", "scalia", "--skip-check", "--json"], {
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    });

    const parsed = JSON.parse(result.stdout) as { deployed?: unknown; url?: unknown };
    expect(parsed.deployed).toBe(true);
    expect(parsed.url).toBe("https://mock.workers.dev/agents/scalia/debate");
    expect(result.stderr).toBe("");
  });

  it("scaffolds bot repos without package-publish or AI-review workflows", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "lqbot-init-"));
    tempPaths.push(tempDir);
    const target = path.join(tempDir, "bot");

    await runCli(["init", target, "--plain"]);

    await expect(stat(path.join(target, ".github", "workflows", "ci.yml"))).resolves.toBeTruthy();
    await expect(
      stat(path.join(target, ".github", "workflows", "publish-npm.yml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      stat(path.join(target, ".github", "workflows", "ci-ai.yml")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(target, "vercel.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      tsx,
      [cli, ...args],
      {
        cwd,
        env: { ...process.env, ...env },
      },
      (error, stdout, stderr) => {
        if (error) {
          const execError = error as ExecError;
          execError.stdout = stdout;
          execError.stderr = stderr;
          reject(execError);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

async function makeFakePnpm(): Promise<string> {
  const fakeBin = await mkdtemp(path.join(os.tmpdir(), "lqbot-pnpm-"));
  tempPaths.push(fakeBin);
  const fakePnpm = path.join(fakeBin, "pnpm");
  await writeFile(
    fakePnpm,
    `#!/usr/bin/env sh
set -eu
if [ "\${1:-} \${2:-} \${3:-} \${4:-}" = "exec wrangler secret put" ]; then
  cat >/dev/null
  exit 0
fi
if [ "\${1:-} \${2:-} \${3:-}" = "exec wrangler deploy" ]; then
  echo "https://mock.workers.dev"
  exit 0
fi
echo "unexpected pnpm invocation: $*" >&2
exit 1
`,
  );
  await chmod(fakePnpm, 0o755);
  return fakeBin;
}
