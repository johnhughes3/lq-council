#!/usr/bin/env node
import { execFileSync } from "node:child_process";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function isTruthy(value) {
  return value === "1" || value === "true" || value === "yes";
}

if (process.env.CI || isTruthy(process.env.LQBOT_SKIP_HOOK_INSTALL)) {
  process.exit(0);
}

try {
  run("git", ["rev-parse", "--is-inside-work-tree"]);
} catch {
  process.exit(0);
}

try {
  const hooksPath = run("git", ["config", "--get", "core.hooksPath"]);
  if (hooksPath.length > 0) {
    process.exit(0);
  }
} catch {
  // No configured hooks path; Lefthook can install into .git/hooks.
}

try {
  execFileSync("lefthook", ["install"], { stdio: "inherit" });
} catch {
  process.exit(0);
}
