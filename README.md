# LQ Council Debate Agent

Secure TypeScript template for standing up LegalQuants LQ Council debate bots on
Cloudflare Workers. The default model path is Kimi K2.6 through Workers AI:

```txt
@cf/moonshotai/kimi-k2.6
```

The repo is intentionally narrow. It accepts the LQ Council webhook, loads a
markdown persona, calls one model provider, enforces a monthly spend cap, filters
unsafe output, and returns the LQ Council debate response envelope.

## Quick Start

Recommended path:

```bash
pnpm dlx @johnhughes/lq-council init my-lq-bot
cd my-lq-bot
pnpm install
pnpm lqbot test --agent scalia
pnpm lqbot deploy --agent scalia
```

Clone-from-source path:

```bash
git clone https://github.com/johnhughes3/lq-council.git
cd lq-council
pnpm install
pnpm lqbot test --agent scalia
pnpm lqbot deploy --agent scalia
```

`deploy` prints the URL and bearer token to register with LQ Council:

```txt
https://<worker>.workers.dev/agents/scalia/debate
lqbot_...
```

Only the token hash is stored remotely.

## Requirements

- Node.js 20.11 or newer
- pnpm 9 or newer
- Cloudflare account with Workers enabled
- Go, only for the local `pnpm security:secrets` Gitleaks wrapper
- Wrangler auth, either interactive or headless:

```bash
pnpm exec wrangler login
```

or:

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
```

Wrangler is already a dev dependency, so users do not need a global install.

## LQ Contract

The Worker exposes:

```http
POST /debate
POST /agents/:agentId/debate
Authorization: Bearer <token>
Content-Type: application/json

{
  "session_id": "string",
  "round": 0,
  "role": "proponent",
  "context": [],
  "prompt": "string"
}
```

It returns:

```json
{
  "response": "...",
  "confidence": 70,
  "challenge": {
    "target_claim": "...",
    "counter_evidence": "...",
    "challenge_type": "factual"
  },
  "position_change": {
    "changed": false,
    "from": "No material change.",
    "to": "Original position maintained.",
    "reason": "No position change was declared in the response."
  }
}
```

`confidence` is always an integer from 0 to 100. The Worker includes `challenge` in round 2 and
`position_change` in round 4. Extra incoming fields are tolerated and ignored.

## Debaters

Debaters live under `agents/<slug>/`.

Required files:

```txt
00-identity.md
10-principles.md
20-style.md
```

Optional topic views:

```txt
views/*.md
```

Create a debater:

```bash
pnpm lqbot agent create textualist --from blank
$EDITOR agents/textualist/00-identity.md
$EDITOR agents/textualist/10-principles.md
$EDITOR agents/textualist/20-style.md
pnpm lqbot test --agent textualist
pnpm lqbot sync --agent textualist
```

See [docs/debaters.md](docs/debaters.md) for persona rules and examples.

The bundled examples are:

- `scalia`: Scalia-inspired originalist/textualist debater
- `kagan`: Kagan-inspired institutionalist/pragmatic textualist debater
- `blank`: safe starting template

They are explicitly inspired personas, not impersonations or endorsements.

## Configuration

Cloudflare defaults are in [wrangler.jsonc](wrangler.jsonc):

| Setting | Default | Purpose |
| --- | --- | --- |
| `LQBOT_DEFAULT_AGENT` | `scalia` | Agent used for `POST /` |
| `LQBOT_PROVIDER` | `cloudflare-workers-ai` | Provider adapter |
| `MONTHLY_BUDGET_USD` | `50` | Monthly spend cap per debater |
| `MAX_BODY_BYTES` | `100000` | Max incoming request body |
| `MODEL_TIMEOUT_MS` | `285000` | Max model-call time before refunding the reservation |

## Observability

Use Cloudflare Worker Logs and Query Builder as the primary request diagnostic store. The Worker
emits structured events for rejected requests and provider failures:

```txt
lq_request_rejected
lq_request_failed
lq_spend_cap_reached
```

These events include request ID, route path, debater slug, status, elapsed time, content type,
content length, JSON keys, field types, prompt length, context length, body hash, and schema issue
paths/codes where available. They deliberately omit the `Authorization` value and raw prompt,
context, response, and session ID. The session ID is logged only as a short SHA-256 hash prefix.

For a live deployment:

```bash
pnpm exec wrangler tail lq-debate-agent
```

For durable history, enable Workers Logs in the Cloudflare dashboard and query for
`lq_request_rejected` or `lq_request_failed`.

Provider options:

| Provider | Model default | Required secrets |
| --- | --- | --- |
| `cloudflare-workers-ai` | `@cf/moonshotai/kimi-k2.6` | none beyond Cloudflare billing |
| `vercel-ai-gateway` | `moonshotai/kimi-k2.6` | `VERCEL_AI_GATEWAY_API_KEY` |
| `openai-compatible` | `kimi-k2.6` | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, optional `OPENAI_MODEL` |

`vercel-ai-gateway` is a model-provider adapter. Cloudflare Workers remains the supported hosting
target for this template.

Set provider secrets with:

```bash
pnpm lqbot secret set OPENAI_API_KEY
pnpm lqbot secret set VERCEL_AI_GATEWAY_API_KEY
```

For provider API keys, paste into Wrangler's prompt or pipe through stdin. `--value` is reserved for
token-hash secrets so API keys do not land in shell history.

See [docs/configuration.md](docs/configuration.md).

## Cost Controls

Every request reserves estimated spend before calling the model. The default cap
is `$50` per debater per calendar month.

If a request would exceed the cap, the Worker returns a normal LQ response explaining that the bot
is paused. No model call is made.

If a model call fails, the reservation is refunded. If the provider reports token
usage, the ledger commits actual usage. Otherwise it falls back to a conservative
character-based estimate.

The production ledger uses a Cloudflare Durable Object.

## Security Defaults

- Bearer auth is required.
- Only SHA-256 token hashes are stored.
- Bodies over 100 KB are rejected.
- Prompt content is treated as untrusted debate data.
- Persona markdown is compiled into the Worker; runtime code does not read local files.
- Canary leakage blocks output.
- Secret-shaped output is blocked.
- Optional MCP tooling is disabled by default.
- Remote MCP, if enabled, must be HTTPS, read-only, allowlisted, timed out, and capped.
- Failed requests are logged through sanitized Cloudflare Worker telemetry.
- Full prompts, context, outputs, bearer tokens, and raw session IDs are not logged.

See [docs/ci-security.md](docs/ci-security.md) for CI and public-repo secret safety.

## CLI

```bash
pnpm lqbot doctor
pnpm lqbot version
pnpm lqbot init [directory]
pnpm lqbot agent list
pnpm lqbot agent create <slug> --from blank
pnpm lqbot test --agent <slug>
pnpm lqbot token create --agent <slug>
pnpm lqbot token rotate --agent <slug>
pnpm lqbot secret set <NAME>
pnpm lqbot deploy --agent <slug> [--save-local]
pnpm lqbot deploy --all
pnpm lqbot sync --agent <slug>
pnpm lqbot smoke --url <url> --token <token>
```

All commands support `--json` for agentic tooling.

Human terminal output uses compact status panels when stdout is an interactive terminal. Use
`--plain`, `NO_TUI=1`, `NO_COLOR=1`, or `TERM=dumb` for simpler output. Non-interactive stdout
continues to default to JSON.

## Local Hooks

The repo uses Lefthook for local guardrails. Lefthook installs automatically on `pnpm install` when
the checkout uses standard `.git/hooks`. You can also run the hooks manually:

```bash
pnpm hooks:install
pnpm hooks:pre-commit
pnpm hooks:pre-push
```

Pre-commit verifies that `src/generated/agents.ts` matches the markdown personas, runs Biome, and
runs the LQ contract tests. Pre-push runs the full local gate plus secret scanning. The hooks do not
deploy or require Cloudflare credentials. If your machine uses a global Git `core.hooksPath`, the
automatic installer quietly skips; run the hook scripts manually or install Lefthook into that
global hook path only if that is how you intentionally manage hooks.

`deploy --agent <slug>` preserves token hashes for existing debaters in the ignored
`.lqbot/token-hashes.json` file. Use `deploy --all` when you want fresh registration tokens for
every deployable debater at once. Add `--save-local` if you want plaintext token copies written to
ignored `0o600` files under `.lqbot/tokens/`; if a deploy fails after token generation, the CLI
saves them there automatically so registration tokens are not lost.

## Copy/Paste Agent Prompt

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```txt
Set up an LQ Council debate bot using the npm package @johnhughes/lq-council.

Source repo for review: https://github.com/johnhughes3/lq-council

Requirements:
- Use pnpm, not npm or yarn, after the project is scaffolded.
- Use Cloudflare Workers + Workers AI as the default deployment target.
- Use Kimi K2.6 via @cf/moonshotai/kimi-k2.6 unless I explicitly choose another OpenAI-compatible provider.
- Do not store secrets in source. Use wrangler secrets through `pnpm lqbot secret set`.
- Create or edit my debater only under agents/<slug>/.
- Required persona files are 00-identity.md, 10-principles.md, and 20-style.md.
- Run `pnpm lqbot test --agent <slug>` and `pnpm check` before deployment.
- Deploy with `pnpm lqbot deploy --agent <slug>`.
- Give me the LQ Council URL and bearer token printed by deploy.

Commands:
1. pnpm dlx @johnhughes/lq-council init my-lq-bot
2. cd my-lq-bot
3. pnpm install
4. pnpm lqbot agent create <slug> --from blank
5. Edit agents/<slug>/ markdown files.
6. pnpm lqbot test --agent <slug>
7. pnpm check
8. pnpm lqbot deploy --agent <slug>
```

## CI And Publishing

CI gates are split into focused jobs:

- Biome format/lint
- TypeScript strict typecheck
- Vitest with 90% global coverage thresholds for statements, branches, functions, and lines
- Coverage artifacts plus gated Codecov upload from `coverage/lcov.info`
- package build and `pnpm pack --dry-run`
- Cloudflare Worker startup build
- GitHub Actions lint
- dependency audit
- Gitleaks secret scan
- dependency review
- CodeQL

The npm publish workflow uses npm trusted publishing through GitHub Actions OIDC.
See [docs/npm-publishing.md](docs/npm-publishing.md).

## Limitations

- This is not a general multi-agent framework.
- The default Worker does not persist debate memory beyond the spend ledger.
- The default deployed bot does not read local files, execute shell commands, or run stdio MCP servers.
- Cloudflare billing/model access must be configured in the user’s Cloudflare account.

## About Contributions

Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.
