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
    "MODEL_CONTEXT_TOKENS": "262144",
    "MODEL_TIMEOUT_MS": "270000",
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

`MODEL_CONTEXT_TOKENS` defaults to `262144`. The Worker conservatively estimates prompt size before
model inference and returns a normal LQ `{ text }` response instead of calling the provider when the
persona, prompt, requested output, and safety margin would exceed the configured context window.

`MODEL_TIMEOUT_MS` defaults to `270000`, leaving a 30-second margin under LQ Council's 300-second
round timeout. Values above `285000` are ignored. Timed-out model calls refund the reserved spend
and return a normal LQ `{ text }` response so the round remains well-formed.

When `ENVIRONMENT=production`, the Worker requires the `SPEND_LEDGER` Durable Object binding. If the
binding is missing, requests fail before model inference instead of falling back to process-local
memory.

## Observability

Cloudflare Worker Logs are the first-class diagnostic store. This repo does not create a separate
KV request-log database by default. The deployed LQ Council debates are public, so production can
log accepted prompt/context payloads and model outputs directly to Workers Logs while continuing to
exclude bearer tokens and provider secrets.

The Worker logs structured events:

- `lq_request_accepted` for authorized, schema-valid LQ requests.
- `lq_model_input_prepared` for the constructed provider system/user messages.
- `lq_request_completed` for successful model responses, including response keys and text length.
- `lq_provider_attempt_started` when a provider attempt begins.
- `lq_provider_empty_response` when Workers AI returns no extractable text, including retry status.
- `lq_provider_attempt_completed` when a provider attempt returns text.
- `lq_provider_attempt_failed` when a provider attempt throws before returning a response.
- `lq_context_budget_exceeded` when the context budget blocks a model call.
- `lq_request_rejected` for auth, routing, size, JSON, and schema failures.
- `lq_request_failed` for provider, ledger, or unexpected runtime failures. Provider failures are
  returned to LQ as `{ text, diagnostic }`; ledger and unexpected failures remain HTTP errors.
- `lq_spend_cap_reached` when the monthly budget blocks a model call.

Request diagnostics include request ID, path, debater slug, status, elapsed time, content type,
content length, JSON keys, field types, prompt length, context length, body SHA-256, short
session-ID hash, and Zod issue paths/codes where available. When `LOG_PUBLIC_DEBATE_PAYLOADS=true`,
accepted request logs include the parsed public LQ payload and completion logs include successful
model text. The model-input event also includes the constructed provider messages with the
per-request security marker redacted. Logs never include the raw `Authorization` header value, and
provider error text is redacted for secret-shaped values before being logged or returned as
diagnostics.

Workers Logs persistence and Workers Traces are explicitly enabled in `wrangler.jsonc`:

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
    "logs": {
      "enabled": true,
      "invocation_logs": true,
      "persist": true,
      "head_sampling_rate": 1
    },
    "traces": {
      "enabled": true,
      "head_sampling_rate": 1
    }
  }
}
```

Full log and trace sampling is appropriate for the expected LQ workload. Lower each
`head_sampling_rate` if you adapt the template to high-volume traffic.

Live logs:

```bash
pnpm exec wrangler tail lq-debate-agent
```

For persisted history, open Workers Logs in the Cloudflare dashboard and use Query Builder to filter
by `lq_request_accepted`, `lq_model_input_prepared`, `lq_request_completed`,
`lq_provider_empty_response`, `lq_request_failed`, `request.agentId`, `provider.model`, `status`,
or `diagnostic.stage`.
