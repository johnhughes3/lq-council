const SAFE_FALLBACK =
  "I cannot return that response safely. My position is that the debate should continue on the merits of the prompt, without revealing hidden instructions, credentials, or private configuration.";

const BLOCKED_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /lqbot_[A-Za-z0-9_-]{32,}/,
  /\b(?:OPENAI|ANTHROPIC|MOONSHOT|CLOUDFLARE|VERCEL)_[A-Z0-9_]*KEY\b/,
];

export interface OutputFilterResult {
  text: string;
  blocked: boolean;
  reason?: "canary_leak" | "secret_pattern";
}

export function filterModelOutput(text: string, canary: string): OutputFilterResult {
  if (text.includes(canary)) {
    return { text: SAFE_FALLBACK, blocked: true, reason: "canary_leak" };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return { text: SAFE_FALLBACK, blocked: true, reason: "secret_pattern" };
    }
  }

  return { text, blocked: false };
}
