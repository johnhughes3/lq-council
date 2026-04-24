---
name: lq-deploy-cloudflare
description: Deploy this LQ debate agent template to Cloudflare Workers with Workers AI and Kimi K2.6.
---

# LQ Cloudflare Deploy

## Prerequisites

- `pnpm install`
- Cloudflare account with Workers enabled
- Wrangler authenticated, or headless env vars:

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
```

## Deploy

```bash
pnpm lqbot deploy --agent <slug>
```

The deploy command:

1. Regenerates `src/generated/agents.ts`.
2. Validates the selected debater.
3. Runs `pnpm check`.
4. Generates a high-entropy bearer token.
5. Stores only the token hash in Cloudflare secret `AGENT_TOKEN_HASHES`.
6. Runs `wrangler deploy`.
7. Prints the LQ URL and bearer token.

For multiple debaters:

```bash
pnpm lqbot deploy --all
```

The CLI preserves existing token hashes in ignored `.lqbot/token-hashes.json`, so deploying one
debater does not invalidate others. Add `--save-local` only when you want plaintext token copies
under ignored `.lqbot/tokens/`. If Wrangler fails after token generation, the CLI saves token copies
there automatically so the new hashes are not orphaned.

## Headless

```bash
CLOUDFLARE_ACCOUNT_ID=... \
CLOUDFLARE_API_TOKEN=... \
pnpm lqbot deploy --agent <slug> --headless
```

## Verify

```bash
pnpm lqbot smoke --url https://<worker>.workers.dev/agents/<slug>/debate --token <token>
```

## Diagnose Requests

Use Cloudflare observability first instead of adding an application request-log database:

```bash
pnpm exec wrangler tail lq-debate-agent
```

The Worker emits sanitized structured logs for `lq_request_rejected`, `lq_request_failed`, and
`lq_spend_cap_reached`. These include request shape, JSON keys, field types, body hash, schema issue
paths/codes, and route metadata, but never raw prompts, context, responses, bearer tokens, or raw
session IDs. For persisted history, enable Workers Logs in the Cloudflare dashboard and query those
event names with Query Builder.

## Safety

- Do not commit `.lqbot/`, `.env`, `.dev.vars`, `.wrangler/`, or tokens.
- Use `wrangler secret put` through `pnpm lqbot secret set <NAME>` for provider keys. Paste
  provider API keys into Wrangler's prompt or pipe through stdin; do not pass them with `--value`.
- Default model: `@cf/moonshotai/kimi-k2.6`.
- Default monthly budget: `$50` per debater. Change `monthlyBudgetUsd` in the debater config.
- Default model timeout: `MODEL_TIMEOUT_MS=285000`; timed-out requests refund local reservations.
