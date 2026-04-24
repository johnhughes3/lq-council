export interface TerminalRenderOptions {
  json: boolean;
  plain: boolean;
  isTTY: boolean;
  columns: number;
  env: Record<string, string | undefined>;
}

type AnsiColor = "cyan" | "green" | "red" | "yellow" | "dim" | "bold";

interface CommandDetails {
  title: string;
  rows: Array<[string, unknown]>;
}

const ANSI: Record<AnsiColor, [string, string]> = {
  cyan: ["\x1b[36m", "\x1b[39m"],
  green: ["\x1b[32m", "\x1b[39m"],
  red: ["\x1b[31m", "\x1b[39m"],
  yellow: ["\x1b[33m", "\x1b[39m"],
  dim: ["\x1b[2m", "\x1b[22m"],
  bold: ["\x1b[1m", "\x1b[22m"],
};
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function terminalOptions(input: {
  json: boolean;
  plain?: boolean;
  stdout?: Pick<NodeJS.WriteStream, "isTTY" | "columns">;
  env?: NodeJS.ProcessEnv;
}): TerminalRenderOptions {
  return {
    json: input.json,
    plain: input.plain ?? false,
    isTTY: input.stdout?.isTTY === true,
    columns: input.stdout?.columns ?? 80,
    env: input.env ?? process.env,
  };
}

export function shouldUseTui(options: TerminalRenderOptions): boolean {
  return (
    !options.json &&
    !options.plain &&
    options.isTTY &&
    options.env.NO_TUI === undefined &&
    options.env.TERM !== "dumb"
  );
}

export function renderHelp(options: TerminalRenderOptions): string {
  const commands: Array<[string, string]> = [
    ["doctor", "Check local tooling and available debaters"],
    ["version", "Print the CLI version"],
    ["init [directory] [--force]", "Scaffold a new bot repo"],
    ["agent list [--json]", "List debater folders"],
    ["agent create <slug> [--from blank]", "Create a new markdown debater"],
    ["test --agent <slug>", "Validate a debater"],
    ["generate", "Bundle markdown personas into src/generated/agents.ts"],
    ["token create --agent <slug> [--json] [--save-local]", "Generate a bearer token"],
    ["token rotate --agent <slug> [--json]", "Generate a replacement bearer token"],
    ["secret set <NAME>", "Store a Wrangler secret"],
    ["deploy --agent <slug> [--headless] [--skip-check] [--save-local]", "Deploy one debater"],
    ["deploy --all [--headless] [--skip-check] [--save-local]", "Deploy every debater"],
    ["sync --agent <slug>", "Regenerate and redeploy persona changes"],
    ["smoke --url <url> --token <token>", "POST a live smoke prompt"],
  ];

  if (!shouldUseTui(options)) {
    return [
      "lqbot",
      "",
      "Usage:",
      ...commands.map(([usage]) => `  pnpm lqbot ${usage}`),
      "",
      "Notes:",
      "  Production secrets are stored with Wrangler. Tokens are printed once by default.",
      "  Use --json for machine-readable output.",
      "  Use --plain or NO_TUI=1 for unstyled human output.",
    ].join("\n");
  }

  const width = panelWidth(options);
  const title = color("lqbot", "bold", options);
  const body = [
    color("Commands", "cyan", options),
    ...commands.map(
      ([usage, description]) => `  ${color(usage, "green", options)}  ${description}`,
    ),
    "",
    color("Notes", "cyan", options),
    "  Production secrets are stored with Wrangler. Tokens are printed once by default.",
    "  Use --json for machine-readable output.",
    "  Use --plain or NO_TUI=1 for unstyled human output.",
  ];
  return renderPanel(title, body, width);
}

export function renderHumanOutput(value: unknown, options: TerminalRenderOptions): string {
  if (!shouldUseTui(options)) {
    return renderPlainValue(value);
  }

  const details = commandDetails(value);
  const body = details.rows.flatMap(([key, item]) => renderRow(key, item, options));
  return renderPanel(color(details.title, "bold", options), body, panelWidth(options));
}

export function renderStep(message: string, options: TerminalRenderOptions): string | null {
  if (!shouldUseTui(options)) return null;
  return `${color(">", "cyan", options)} ${message}`;
}

export function renderError(message: string, options: TerminalRenderOptions): string {
  if (!shouldUseTui(options)) return message;
  return `${color("error", "red", options)} ${message}`;
}

function commandDetails(value: unknown): CommandDetails {
  if (!isRecord(value)) return { title: "Result", rows: [["value", value]] };

  if ("initialized" in value) {
    return ordered("Project initialized", value, ["initialized", "nextSteps"]);
  }
  if ("deployed" in value) {
    return ordered("Deploy complete", value, [
      "agent",
      "url",
      "bearerToken",
      "tokenHash",
      "localTokenCopiesSaved",
      "agents",
      "note",
    ]);
  }
  if ("synced" in value) {
    return ordered("Sync complete", value, ["synced", "deployOutput"]);
  }
  if ("ok" in value && "checks" in value) {
    return ordered("Doctor", value, ["ok", "checks", "agents"]);
  }
  if ("created" in value && "path" in value) {
    return ordered("Debater created", value, ["created", "path"]);
  }
  if ("generated" in value) {
    return ordered("Personas generated", value, ["generated", "agents"]);
  }
  if ("agent" in value && "files" in value) {
    return ordered("Debater valid", value, ["agent", "provider", "model", "files"]);
  }
  if ("token" in value && "tokenHash" in value) {
    return ordered("Token generated", value, [
      "agent",
      "token",
      "tokenHash",
      "localCopySaved",
      "note",
    ]);
  }
  if ("secret" in value && "stored" in value) {
    return ordered("Secret stored", value, ["secret", "stored"]);
  }
  if ("status" in value && "text" in value) {
    return ordered("Smoke test", value, ["ok", "status", "text"]);
  }

  return {
    title: "Result",
    rows: Object.entries(value),
  };
}

function ordered(title: string, value: Record<string, unknown>, keys: string[]): CommandDetails {
  const seen = new Set(keys);
  return {
    title,
    rows: [
      ...keys.filter((key) => key in value).map((key) => [key, value[key]] as [string, unknown]),
      ...Object.entries(value).filter(([key]) => !seen.has(key)),
    ],
  };
}

function renderPanel(title: string, body: string[], width: number): string {
  const top = `+-- ${title} ${"-".repeat(Math.max(0, width - visibleLength(title) - 6))}+`;
  const bottom = `+${"-".repeat(width - 2)}+`;
  const lines = body.length > 0 ? body : [""];
  return [
    top,
    ...lines.flatMap((line) => wrapLine(line, width - 4)).map((line) => boxedLine(line, width)),
    bottom,
  ].join("\n");
}

function boxedLine(line: string, width: number): string {
  return `| ${line}${" ".repeat(Math.max(0, width - visibleLength(line) - 4))} |`;
}

function renderRow(key: string, value: unknown, options: TerminalRenderOptions): string[] {
  const label = color(`${humanizeKey(key)}:`, labelColor(value), options);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${label} ${color("(none)", "dim", options)}`];
    return [
      label,
      ...value.flatMap((item, index) =>
        renderArrayItem(index, item, options).map((line) => `  ${line}`),
      ),
    ];
  }
  if (isRecord(value)) {
    return [
      label,
      ...Object.entries(value).map(([k, v]) => `  ${humanizeKey(k)}: ${formatScalar(v)}`),
    ];
  }
  return [`${label} ${formatScalar(value)}`];
}

function renderArrayItem(index: number, item: unknown, options: TerminalRenderOptions): string[] {
  const prefix = color(`${index + 1}.`, "dim", options);
  if (!isRecord(item)) return [`${prefix} ${formatScalar(item)}`];
  const entries = Object.entries(item);
  if (entries.length === 0) return [`${prefix} {}`];
  const [firstKey, firstValue] = entries[0] ?? ["value", ""];
  return [
    `${prefix} ${humanizeKey(firstKey)}: ${formatScalar(firstValue)}`,
    ...entries.slice(1).map(([key, value]) => `   ${humanizeKey(key)}: ${formatScalar(value)}`),
  ];
}

function renderPlainValue(value: unknown): string {
  if (!isRecord(value)) return String(value);
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${typeof item === "string" ? item : JSON.stringify(item)}`)
    .join("\n");
}

function formatScalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

function labelColor(value: unknown): AnsiColor {
  if (value === true) return "green";
  if (value === false) return "red";
  return "cyan";
}

function color(text: string, colorName: AnsiColor, options: TerminalRenderOptions): string {
  if (options.env.NO_COLOR !== undefined) return text;
  const [open, close] = ANSI[colorName];
  return `${open}${text}${close}`;
}

function wrapLine(line: string, width: number): string[] {
  if (visibleLength(line) <= width) return [line];

  const words = line.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (visibleLength(word) > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(...chunkLongWord(word, width));
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (visibleLength(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [line];
}

function chunkLongWord(word: string, width: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < word.length; index += width) {
    chunks.push(word.slice(index, index + width));
  }
  return chunks;
}

function panelWidth(options: TerminalRenderOptions): number {
  return Math.max(60, Math.min(100, options.columns - 2));
}

function humanizeKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
}

function visibleLength(value: string): number {
  return value.replace(ANSI_PATTERN, "").length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
