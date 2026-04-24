#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderError,
  renderHelp,
  renderHumanOutput,
  renderStep,
  terminalOptions,
} from "../src/cli/terminal";
import { sha256Hex } from "../src/security/auth";
import type { AgentDefinition, PersonaFile, ProviderName } from "../src/types";

interface CliOptions {
  json: boolean;
  plain: boolean;
  headless: boolean;
  skipCheck: boolean;
  saveLocal: boolean;
  all: boolean;
  force: boolean;
  agent?: string;
  from?: string;
  provider?: ProviderName;
  url?: string;
  token?: string;
  value?: string;
}

interface CliContext {
  cwd: string;
  options: CliOptions;
}

type TokenHashMap = Record<string, string>;

const REQUIRED_PERSONA_FILES = ["00-identity.md", "10-principles.md", "20-style.md"];
const DEFAULT_PROVIDER: ProviderName = "cloudflare-workers-ai";
const DEFAULT_MODEL = "@cf/moonshotai/kimi-k2.6";
const GENERATED_HEADER = 'import type { AgentDefinition } from "../types";\n\n';
const LOCAL_TOKEN_HASHES_PATH = path.join(".lqbot", "token-hashes.json");
const PACKAGE_VERSION = "0.1.0";

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    renderError(
      message,
      terminalOptions({
        json: process.argv.includes("--json"),
        plain: process.argv.includes("--plain"),
        stdout: process.stderr,
      }),
    ),
  );
  process.exit(error instanceof UsageError ? 2 : 1);
});

async function main(): Promise<void> {
  const [command = "help", ...rest] = process.argv.slice(2);
  const options = parseOptions(rest);
  const ctx: CliContext = { cwd: process.cwd(), options };

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      return printHelp(ctx);
    case "version":
    case "--version":
    case "-V":
      return printVersion(ctx);
    case "doctor":
      return doctor(ctx);
    case "init":
      return initProject(ctx, rest);
    case "agent":
      return agentCommand(ctx, rest);
    case "generate":
      return generate(ctx);
    case "test":
      return testAgent(ctx);
    case "token":
      return tokenCommand(ctx, rest);
    case "secret":
      return secretCommand(ctx, rest);
    case "deploy":
      return deploy(ctx);
    case "sync":
      return sync(ctx);
    case "smoke":
      return smoke(ctx);
    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

function printHelp(ctx: CliContext): void {
  console.log(renderHelp(renderOptions(ctx)));
}

function printVersion(ctx: CliContext): void {
  if (ctx.options.json) {
    output(ctx, { version: PACKAGE_VERSION });
    return;
  }
  console.log(PACKAGE_VERSION);
}

async function initProject(ctx: CliContext, args: string[]): Promise<void> {
  const directory = args.find((arg) => !arg.startsWith("--")) ?? ".";
  const target = path.resolve(ctx.cwd, directory);
  await mkdir(target, { recursive: true });

  const existingEntries = await readdir(target).catch(() => []);
  if (existingEntries.length > 0 && !ctx.options.force) {
    throw new Error(
      `Target directory is not empty: ${target}. Use --force to merge template files.`,
    );
  }

  const root = packageRoot();
  const pathsToCopy = [
    "agents",
    ".agents",
    ".github/dependabot.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/codeql.yml",
    "docs/configuration.md",
    "docs/debaters.md",
    "src",
    "scripts",
    "tests",
    ".env.example",
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "LICENSE",
    "biome.json",
    "codecov.yml",
    "lefthook.yml",
    "tsconfig.json",
    "tsup.config.ts",
    "vitest.config.ts",
    "wrangler.jsonc",
  ];

  for (const relativePath of pathsToCopy) {
    const source = path.join(root, relativePath);
    const destination = path.join(target, relativePath);
    if (await exists(source)) {
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination, {
        recursive: true,
        force: ctx.options.force,
        errorOnExist: !ctx.options.force,
      });
    }
  }

  const projectName = await writeProjectPackageJson(target);
  await writeProjectReadme(target, projectName);
  await ensureClaudeInstructions(target);
  output(ctx, {
    initialized: target,
    nextSteps: [
      `cd ${path.relative(ctx.cwd, target) || "."}`,
      "pnpm install",
      "pnpm lqbot test --agent scalia",
      "pnpm lqbot deploy --agent scalia",
    ],
  });
}

async function doctor(ctx: CliContext): Promise<void> {
  const checks = [
    await commandAvailable("pnpm", ["--version"]),
    await commandAvailable("pnpm", ["exec", "wrangler", "--version"]),
  ];
  const agents = await listAgentDirs(ctx.cwd);
  output(ctx, {
    ok: checks.every((check) => check.ok),
    checks,
    agents,
  });
}

async function agentCommand(ctx: CliContext, args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "list") {
    const agents = await listAgentDirs(ctx.cwd);
    output(ctx, { agents });
    return;
  }
  if (subcommand === "create") {
    const slug = args.find((arg, index) => index > 0 && !arg.startsWith("--"));
    if (!slug) throw new UsageError("Usage: pnpm lqbot agent create <slug> [--from blank]");
    await createAgent(ctx, slug, ctx.options.from ?? "blank");
    output(ctx, { created: slug, path: `agents/${slug}` });
    return;
  }
  throw new UsageError("Usage: pnpm lqbot agent list | pnpm lqbot agent create <slug>");
}

async function createAgent(ctx: CliContext, slug: string, from: string): Promise<void> {
  validateSlug(slug);
  validateSlug(from);
  const source = path.join(ctx.cwd, "agents", from);
  const destination = path.join(ctx.cwd, "agents", slug);
  await assertExists(source);
  try {
    await access(destination, fsConstants.F_OK);
    throw new Error(`Agent already exists: ${slug}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await cp(source, destination, { recursive: true, errorOnExist: true });
}

async function generate(ctx: CliContext): Promise<void> {
  output(ctx, await generateAgentsFile(ctx.cwd));
}

async function generateAgentsFile(cwd: string): Promise<{ generated: string; agents: string[] }> {
  const agents = await loadAgentsFromDisk(cwd, { includeBlank: false });
  const source = renderGeneratedAgents(agents);
  const target = path.join(cwd, "src", "generated", "agents.ts");
  await writeFile(target, source, "utf8");
  return { generated: target, agents: agents.map((agent) => agent.id) };
}

async function testAgent(ctx: CliContext): Promise<void> {
  const agentId = requireAgent(ctx);
  const agent = await loadAgentById(ctx.cwd, agentId, { includeBlank: true });
  validateAgentDefinition(agent);
  output(ctx, {
    ok: true,
    agent: agent.id,
    files: agent.files.map((file) => file.path),
    provider: agent.provider,
    model: agent.model,
  });
}

async function tokenCommand(ctx: CliContext, args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "create" && subcommand !== "rotate") {
    throw new UsageError("Usage: pnpm lqbot token create --agent <slug>");
  }
  const agentId = requireAgent(ctx);
  const token = generateToken();
  const hash = await sha256Hex(token);
  if (ctx.options.saveLocal) {
    await mkdir(path.join(ctx.cwd, ".lqbot", "tokens"), { recursive: true });
    await writeFile(path.join(ctx.cwd, ".lqbot", "tokens", `${agentId}.token`), `${token}\n`, {
      mode: 0o600,
    });
  }
  output(ctx, {
    agent: agentId,
    token,
    tokenHash: hash,
    localCopySaved: ctx.options.saveLocal,
    note: "Store the token in LQ Council. Store only tokenHash in deployment secrets.",
  });
}

async function secretCommand(ctx: CliContext, args: string[]): Promise<void> {
  if (args[0] !== "set") {
    throw new UsageError("Usage: pnpm lqbot secret set <NAME>");
  }
  const name = args.find((arg, index) => index > 0 && !arg.startsWith("--"));
  if (!name) throw new UsageError("Secret name is required");
  if (
    ctx.options.value !== undefined &&
    name !== "AGENT_TOKEN_HASHES" &&
    name !== "BOT_TOKEN_HASH"
  ) {
    throw new UsageError(
      "--value is only allowed for token-hash secrets. Pipe provider API keys through stdin instead.",
    );
  }
  await putWranglerSecret(name, ctx.options.value);
  output(ctx, { secret: name, stored: true });
}

async function deploy(ctx: CliContext): Promise<void> {
  const agentIds = await selectDeployAgentIds(ctx);
  step(ctx, "Generating bundled persona definitions");
  await generateAgentsFile(ctx.cwd);
  step(ctx, "Validating selected debaters");
  const agents = await Promise.all(
    agentIds.map((agentId) => loadAgentById(ctx.cwd, agentId, { includeBlank: false })),
  );
  for (const agent of agents) {
    validateAgentDefinition(agent);
  }
  if (!ctx.options.skipCheck) {
    step(ctx, "Running local quality gates");
    await run("pnpm", ["check"], { cwd: ctx.cwd });
  }

  step(ctx, "Generating registration tokens");
  const existingTokenHashes = await readLocalTokenHashes(ctx.cwd);
  const tokens: Array<{
    agent: string;
    bearerToken: string;
    tokenHash: string;
  }> = [];
  for (const agent of agents) {
    const token = generateToken();
    const tokenHash = await sha256Hex(token);
    existingTokenHashes[agent.id] = tokenHash;
    tokens.push({ agent: agent.id, bearerToken: token, tokenHash });
  }

  await writeLocalTokenHashes(ctx.cwd, existingTokenHashes);
  if (ctx.options.saveLocal) {
    await writeLocalPlaintextTokens(ctx.cwd, tokens);
  }

  try {
    step(ctx, "Storing token hashes in Cloudflare secrets");
    await putWranglerSecret("AGENT_TOKEN_HASHES", JSON.stringify(existingTokenHashes));
    step(ctx, "Deploying Worker");
    const deployOutput = await run("pnpm", ["exec", "wrangler", "deploy"], { cwd: ctx.cwd });
    const url = extractWorkersUrl(deployOutput.stdout);
    const baseUrl = url?.replace(/\/+$/, "") ?? null;
    const registrations = tokens.map((token) => ({
      ...token,
      url: baseUrl ? `${baseUrl}/agents/${token.agent}/debate` : null,
    }));
    const first = registrations[0];
    output(ctx, {
      deployed: true,
      agent: first?.agent ?? null,
      url: first?.url ?? null,
      bearerToken: first?.bearerToken ?? null,
      tokenHash: first?.tokenHash ?? null,
      agents: registrations,
      localTokenCopiesSaved: ctx.options.saveLocal,
      note: "Bearer token is printed once. Register the URL and token with LQ Council.",
    });
  } catch (error) {
    if (!ctx.options.saveLocal) {
      await writeLocalPlaintextTokens(ctx.cwd, tokens);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Deploy failed after token generation. Plaintext token copies were saved under .lqbot/tokens/ so they are not lost.\n${message}`,
    );
  }
}

async function sync(ctx: CliContext): Promise<void> {
  requireAgent(ctx);
  step(ctx, "Generating bundled persona definitions");
  await generateAgentsFile(ctx.cwd);
  if (!ctx.options.skipCheck) {
    step(ctx, "Running local quality gates");
    await run("pnpm", ["check"], { cwd: ctx.cwd });
  }
  step(ctx, "Deploying Worker");
  const deployOutput = await run("pnpm", ["exec", "wrangler", "deploy"], { cwd: ctx.cwd });
  output(ctx, { synced: true, deployOutput: deployOutput.stdout });
}

async function smoke(ctx: CliContext): Promise<void> {
  const url = ctx.options.url;
  const token = ctx.options.token;
  if (!url || !token) {
    throw new UsageError("Usage: pnpm lqbot smoke --url <url> --token <token>");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session_id: "lqbot-smoke",
      round: 0,
      role: "steelman",
      context: [],
      prompt:
        "Introduce yourself in two or three sentences: who you are, what you bring to a debate, and what makes you distinct from a generic assistant.",
    }),
  });

  const body = (await response.json().catch(() => null)) as { response?: unknown } | null;
  const ok = response.ok && typeof body?.response === "string" && body.response.trim().length > 0;
  output(ctx, {
    ok,
    status: response.status,
    text: typeof body?.response === "string" ? body.response : null,
  });
  if (!ok) process.exitCode = 1;
}

async function loadAgentsFromDisk(
  cwd: string,
  options: { includeBlank: boolean },
): Promise<AgentDefinition[]> {
  const agentIds = await listAgentDirs(cwd);
  const selected = options.includeBlank
    ? agentIds
    : agentIds.filter((agentId) => agentId !== "blank");
  const agents = await Promise.all(selected.map((agentId) => loadAgentFromDisk(cwd, agentId)));
  return agents.sort((a, b) => a.id.localeCompare(b.id));
}

async function loadAgentFromDisk(cwd: string, agentId: string): Promise<AgentDefinition> {
  const root = path.join(cwd, "agents", agentId);
  const files = await collectMarkdownFiles(root);
  const personaFiles: PersonaFile[] = [];
  for (const file of files) {
    personaFiles.push({
      path: path.relative(root, file).replaceAll(path.sep, "/"),
      content: await readFile(file, "utf8"),
    });
  }

  const title = titleCase(agentId);
  return {
    id: agentId,
    displayName:
      agentId === "scalia"
        ? "Scalia-inspired Originalist"
        : agentId === "kagan"
          ? "Kagan-inspired Institutionalist"
          : `${title} Debater`,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    maxOutputTokens: 1600,
    monthlyBudgetUsd: 50,
    security: {
      maxBodyBytes: 100000,
      allowRemoteMcp: false,
      maxToolCallsPerRound: 0,
    },
    files: personaFiles.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function listAgentDirs(cwd: string): Promise<string[]> {
  const root = path.join(cwd, "agents");
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^[a-z][a-z0-9-]{1,62}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function selectDeployAgentIds(ctx: CliContext): Promise<string[]> {
  if (!ctx.options.all) {
    return [requireAgent(ctx)];
  }

  const agentIds = (await listAgentDirs(ctx.cwd)).filter((agentId) => agentId !== "blank");
  if (agentIds.length === 0) {
    throw new UsageError("No deployable agents found under agents/");
  }
  return agentIds;
}

async function loadAgentById(
  cwd: string,
  agentId: string,
  options: { includeBlank: boolean },
): Promise<AgentDefinition> {
  if (!options.includeBlank && agentId === "blank") {
    throw new UsageError("The blank template cannot be deployed");
  }
  const agents = await loadAgentsFromDisk(cwd, options);
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  return agent;
}

function renderGeneratedAgents(agents: AgentDefinition[]): string {
  const body = JSON.stringify(
    Object.fromEntries(agents.map((agent) => [agent.id, agent])),
    null,
    2,
  );
  return `${GENERATED_HEADER}// Generated by \`pnpm lqbot generate\`. Edit files under agents/ instead.\nexport const GENERATED_AGENTS: Record<string, AgentDefinition> = ${body};\n`;
}

function validateAgentDefinition(agent: AgentDefinition): void {
  const paths = new Set(agent.files.map((file) => file.path));
  for (const required of REQUIRED_PERSONA_FILES) {
    if (!paths.has(required)) {
      throw new Error(`Agent ${agent.id} is missing required file: ${required}`);
    }
  }

  const joined = agent.files.map((file) => file.content).join("\n");
  const impersonationPatterns = [
    /\bI am Justice\b/i,
    /\bI am Antonin Scalia\b/i,
    /\bI am Elena Kagan\b/i,
    /\bendorsed by Justice\b/i,
  ];
  for (const pattern of impersonationPatterns) {
    if (pattern.test(joined)) {
      throw new Error(`Agent ${agent.id} contains unsafe impersonation language`);
    }
  }
}

function parseOptions(args: string[]): CliOptions {
  const plain = args.includes("--plain");
  const options: CliOptions = {
    json: args.includes("--json") || (!plain && !process.stdout.isTTY),
    plain,
    headless: args.includes("--headless"),
    skipCheck: args.includes("--skip-check"),
    saveLocal: args.includes("--save-local"),
    all: args.includes("--all"),
    force: args.includes("--force"),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--agent" && next) options.agent = next;
    if (arg === "--from" && next) options.from = next;
    if (arg === "--provider" && isProvider(next)) options.provider = next;
    if (arg === "--url" && next) options.url = next;
    if (arg === "--token" && next) options.token = next;
    if (arg === "--value" && next) options.value = next;
  }

  return options;
}

function requireAgent(ctx: CliContext): string {
  const agent = ctx.options.agent;
  if (!agent) throw new UsageError("Missing required --agent <slug>");
  validateSlug(agent);
  return agent;
}

function validateSlug(slug: string): void {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(slug)) {
    throw new UsageError(`Invalid debater slug: ${slug}`);
  }
}

function isProvider(value: string | undefined): value is ProviderName {
  return (
    value === "cloudflare-workers-ai" ||
    value === "vercel-ai-gateway" ||
    value === "openai-compatible"
  );
}

function generateToken(): string {
  return `lqbot_${randomBytes(32).toString("base64url")}`;
}

async function readLocalTokenHashes(cwd: string): Promise<TokenHashMap> {
  const filePath = path.join(cwd, LOCAL_TOKEN_HASHES_PATH);
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isTokenHashMap(parsed)) {
      throw new Error(`${LOCAL_TOKEN_HASHES_PATH} must be a JSON object of agent slug to hash`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeLocalTokenHashes(cwd: string, tokenHashes: TokenHashMap): Promise<void> {
  const filePath = path.join(cwd, LOCAL_TOKEN_HASHES_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(tokenHashes, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function writeLocalPlaintextTokens(
  cwd: string,
  tokens: Array<{ agent: string; bearerToken: string }>,
): Promise<void> {
  const tokenDirectory = path.join(cwd, ".lqbot", "tokens");
  await mkdir(tokenDirectory, { recursive: true });
  await Promise.all(
    tokens.map((token) =>
      writeFile(path.join(tokenDirectory, `${token.agent}.token`), `${token.bearerToken}\n`, {
        encoding: "utf8",
        mode: 0o600,
      }),
    ),
  );
}

function isTokenHashMap(value: unknown): value is TokenHashMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([agentId, hash]) => /^[a-z][a-z0-9-]{1,62}$/.test(agentId) && isSha256Hex(hash),
  );
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function putWranglerSecret(name: string, value: string | undefined): Promise<void> {
  const options: { cwd: string; stdin?: string; inheritStdin?: boolean } = { cwd: process.cwd() };
  if (value !== undefined) options.stdin = value;
  else options.inheritStdin = true;
  await run("pnpm", ["exec", "wrangler", "secret", "put", name], options);
}

async function commandAvailable(
  command: string,
  args: string[],
): Promise<{ command: string; ok: boolean; version?: string }> {
  try {
    const result = await run(command, args, { cwd: process.cwd() });
    return { command: [command, ...args].join(" "), ok: true, version: result.stdout.trim() };
  } catch {
    return { command: [command, ...args].join(" "), ok: false };
  }
}

async function run(
  command: string,
  args: string[],
  options: { cwd: string; stdin?: string; inheritStdin?: boolean },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: [options.inheritStdin ? "inherit" : "pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!process.stdout.isTTY) return;
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (!process.stderr.isTTY) return;
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${stderr}`));
    });
    if (!options.inheritStdin) {
      if (options.stdin) child.stdin?.end(`${options.stdin}\n`);
      else child.stdin?.end();
    }
  });
}

async function assertExists(filePath: string): Promise<void> {
  try {
    await stat(filePath);
  } catch {
    throw new Error(`Path does not exist: ${filePath}`);
  }
}

function extractWorkersUrl(outputText: string): string | null {
  return outputText.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0] ?? null;
}

function titleCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function output(ctx: CliContext, value: unknown): void {
  if (ctx.options.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  console.log(renderHumanOutput(value, renderOptions(ctx)));
}

function step(ctx: CliContext, message: string): void {
  const rendered = renderStep(message, renderOptions(ctx));
  if (rendered) console.error(rendered);
}

function renderOptions(ctx: CliContext) {
  return terminalOptions({
    json: ctx.options.json,
    plain: ctx.options.plain,
    stdout: process.stdout,
  });
}

export const __filename = fileURLToPath(import.meta.url);

function packageRoot(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  if (path.basename(current) === "dist") return path.dirname(current);
  if (path.basename(current) === "scripts") return path.dirname(current);
  return process.cwd();
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeProjectPackageJson(target: string): Promise<string> {
  const projectName = projectNameFromTarget(target);
  const projectPackageJson = {
    name: projectName,
    version: "0.1.0",
    private: true,
    type: "module",
    packageManager: "pnpm@10.33.2",
    scripts: {
      lqbot: "tsx scripts/lqbot.ts",
      "generate:agents": "tsx scripts/lqbot.ts generate",
      dev: "wrangler dev",
      deploy: "wrangler deploy",
      build: "tsup",
      format: "biome check . --write",
      lint: "biome check .",
      typecheck: "tsc --noEmit",
      test: "vitest run --coverage",
      "test:watch": "vitest",
      "test:contract": "vitest run tests/contract.test.ts",
      "test:security":
        "vitest run tests/auth.test.ts tests/output-filter.test.ts tests/worker.test.ts tests/cost-ledger.test.ts tests/mcp.test.ts",
      check: "pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm pack:dry",
      "pack:dry": "pnpm pack --dry-run",
      prepack: "pnpm build",
      "hooks:install": "lefthook install",
      "hooks:pre-commit": "lefthook run pre-commit --force --no-auto-install",
      "hooks:pre-push": "lefthook run pre-push --force --no-auto-install",
      prepare: "node scripts/install-hooks.mjs",
      "security:audit": "pnpm audit --audit-level high",
      "security:secrets":
        "go run github.com/zricethezav/gitleaks/v8@latest detect --source . --no-git --redact",
    },
    dependencies: {
      hono: "^4.12.14",
      zod: "^4.3.6",
    },
    devDependencies: {
      "@biomejs/biome": "^2.4.13",
      "@cloudflare/workers-types": "^4.20260424.1",
      "@types/node": "^25.6.0",
      "@vitest/coverage-v8": "^3.2.4",
      lefthook: "^2.1.6",
      tsup: "^8.5.1",
      tsx: "^4.21.0",
      typescript: "^5.9.3",
      vitest: "^3.2.4",
      wrangler: "^4.84.1",
    },
    engines: {
      node: ">=20.11.0",
      pnpm: ">=9.0.0",
    },
  };

  await writeFile(
    path.join(target, "package.json"),
    `${JSON.stringify(projectPackageJson, null, 2)}\n`,
  );
  return projectName;
}

function projectNameFromTarget(target: string): string {
  return (
    path
      .basename(target)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-") || "lq-bot"
  );
}

async function writeProjectReadme(target: string, projectName: string): Promise<void> {
  const markdown = `# ${projectName}

LQ Council debate bot scaffolded from \`@johnhughes3/lq-council\`.

## Quick Start

\`\`\`bash
pnpm install
pnpm lqbot test --agent scalia
pnpm lqbot deploy --agent scalia
\`\`\`

The deploy command prints the LQ Council URL and bearer token. Register both with LQ Council.
Only token hashes are stored in Cloudflare secrets.

## Debaters

Debaters live under \`agents/<slug>/\`. Each debater needs:

\`\`\`txt
00-identity.md
10-principles.md
20-style.md
\`\`\`

Create a new debater:

\`\`\`bash
pnpm lqbot agent create my-debater --from blank
pnpm lqbot test --agent my-debater
pnpm lqbot sync --agent my-debater
\`\`\`

## Configuration

Cloudflare Worker settings are in \`wrangler.jsonc\`. Runtime secrets are set through Wrangler:

\`\`\`bash
pnpm lqbot secret set OPENAI_API_KEY
pnpm lqbot secret set VERCEL_AI_GATEWAY_API_KEY
\`\`\`

For provider API keys, do not use \`--value\`; paste into Wrangler's prompt or pipe through stdin.

## CLI

\`\`\`bash
pnpm lqbot help
pnpm lqbot doctor
pnpm lqbot test --agent scalia
pnpm lqbot deploy --agent scalia
pnpm lqbot smoke --url https://<worker>.workers.dev/agents/scalia/debate --token <token>
\`\`\`

Use \`--json\` for machine-readable output and \`--plain\`, \`NO_TUI=1\`, or \`NO_COLOR=1\` for simpler terminal output.

## Local Hooks

Lefthook installs automatically on \`pnpm install\` when the checkout uses standard \`.git/hooks\`.
You can also run the hooks manually:

\`\`\`bash
pnpm hooks:install
pnpm hooks:pre-commit
pnpm hooks:pre-push
\`\`\`

Pre-commit verifies generated personas, linting, and contract tests. Pre-push runs the full local
gate plus secret scanning. Hooks never deploy or require Cloudflare credentials. If your machine
uses a global Git \`core.hooksPath\`, the automatic installer quietly skips; run these scripts
manually or install Lefthook into that global hook path only if that is how you intentionally manage
hooks.

## Security

- Do not commit \`.env\`, \`.dev.vars\`, \`.lqbot/\`, or tokens.
- The production Worker requires the \`SPEND_LEDGER\` Durable Object binding.
- Persona markdown is bundled into the Worker; the deployed bot does not read local files.
- Optional MCP tooling is disabled by default.
`;

  await writeFile(path.join(target, "README.md"), markdown);
}

async function ensureClaudeInstructions(target: string): Promise<void> {
  const claudeDir = path.join(target, ".claude");
  await mkdir(claudeDir, { recursive: true });
  const claudePath = path.join(claudeDir, "CLAUDE.md");
  try {
    await access(claudePath, fsConstants.F_OK);
    return;
  } catch {
    // continue
  }

  try {
    await fsSymlink("../AGENTS.md", claudePath);
  } catch {
    await cp(path.join(target, "AGENTS.md"), claudePath);
  }
}

async function fsSymlink(target: string, filePath: string): Promise<void> {
  const { symlink } = await import("node:fs/promises");
  await symlink(target, filePath);
}
