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
