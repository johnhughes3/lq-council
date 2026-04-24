# Configuration

## Cloudflare Vars

Configure default runtime behavior in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "LQBOT_DEFAULT_AGENT": "scalia",
    "LQBOT_PROVIDER": "cloudflare-workers-ai",
    "MONTHLY_BUDGET_USD": "50",
    "MAX_BODY_BYTES": "100000",
    "MODEL_TIMEOUT_MS": "285000",
    "ENVIRONMENT": "production"
  },
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  }
}
```

## Secrets

Never commit secrets. Set production secrets with Wrangler through the CLI:

```bash
pnpm lqbot secret set AGENT_TOKEN_HASHES
pnpm lqbot secret set OPENAI_API_KEY
pnpm lqbot secret set VERCEL_AI_GATEWAY_API_KEY
```

`AGENT_TOKEN_HASHES` is JSON:

```json
{ "scalia": "sha256_hex_hash" }
```

`pnpm lqbot deploy --agent <slug>` generates this automatically for the selected agent and
preserves previously generated hashes in `.lqbot/token-hashes.json` so deploying one debater does
not invalidate the others. `.lqbot/` is gitignored.

Use `pnpm lqbot deploy --all` to generate fresh tokens for every deployable debater in one pass.
Use `--save-local` only when you want plaintext token copies under `.lqbot/tokens/`. If Wrangler
fails after token generation, the CLI writes those copies automatically so a remotely stored hash is
not orphaned.

## Providers

### Cloudflare Workers AI

Default provider:

```txt
LQBOT_PROVIDER=cloudflare-workers-ai
model=@cf/moonshotai/kimi-k2.6
```

No separate model API key is needed. Billing is through Cloudflare.

### Vercel AI Gateway

```txt
LQBOT_PROVIDER=vercel-ai-gateway
VERCEL_AI_GATEWAY_API_KEY=...
```

This is a provider adapter, not a Vercel hosting target. The supported hosting target in this
template is Cloudflare Workers.

### OpenAI-Compatible

```txt
LQBOT_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://api.moonshot.ai/v1
OPENAI_API_KEY=...
OPENAI_MODEL=kimi-k2.6
```

## Spend Cap

`MONTHLY_BUDGET_USD` defaults to `50`.

The Worker reserves estimated spend before model inference. If the cap would be exceeded, no model
call is made. Successful calls commit actual provider token usage when available.

`MODEL_TIMEOUT_MS` defaults to `285000`, leaving a small margin under LQ Council's 300-second
round timeout. Timed-out model calls throw a provider error and refund the
reserved spend before the Worker returns.

When `ENVIRONMENT=production`, the Worker requires the `SPEND_LEDGER` Durable Object binding. If the
binding is missing, requests fail before model inference instead of falling back to process-local
memory.

## Observability

Cloudflare Worker Logs are the first-class diagnostic store. This repo does not create a separate
KV request-log database by default because failed LQ submissions can contain untrusted debate
content. Persisting raw payloads would increase privacy and exfiltration risk.

The Worker logs sanitized structured events:

- `lq_request_completed` for successful model responses, including response keys and text length.
- `lq_request_rejected` for auth, routing, size, JSON, and schema failures.
- `lq_request_failed` for provider, ledger, or unexpected runtime failures.
- `lq_spend_cap_reached` when the monthly budget blocks a model call.

Request diagnostics include metadata and shape only: request ID, path, debater slug, status,
elapsed time, content type, content length, JSON keys, field types, prompt length, context length,
body SHA-256, short session-ID hash, and Zod issue paths/codes. They do not include bearer tokens,
raw prompts, context, responses, raw session IDs, or provider secrets.

Workers Logs persistence is explicitly enabled in `wrangler.jsonc`:

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  }
}
```

Full sampling is appropriate for the expected LQ workload. Lower `head_sampling_rate` if you adapt
the template to high-volume traffic.

Live logs:

```bash
pnpm exec wrangler tail lq-debate-agent
```

For persisted history, open Workers Logs in the Cloudflare dashboard and use Query Builder to filter
by `lq_request_completed`, `lq_request_rejected`, `lq_request_failed`, `request.agentId`, `status`,
or `diagnostic.stage`.
