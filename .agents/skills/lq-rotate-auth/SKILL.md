---
name: lq-rotate-auth
description: Rotate bearer tokens for LQ Council debaters without committing secrets.
---

# LQ Auth Rotation

## Rotate

```bash
pnpm lqbot token rotate --agent <slug> --json
```

The output includes:

```json
{
  "agent": "<slug>",
  "token": "lqbot_...",
  "tokenHash": "..."
}
```

Store `token` in LQ Council. Store only `tokenHash` in deployment secrets.

## Push Hash To Cloudflare

For a single-agent Worker:

```bash
pnpm lqbot secret set AGENT_TOKEN_HASHES --value '{"<slug>":"<tokenHash>"}'
pnpm lqbot sync --agent <slug>
```

For full redeploy with a new token:

```bash
pnpm lqbot deploy --agent <slug>
```

`deploy` preserves other debaters' hashes in `.lqbot/token-hashes.json`. Use `pnpm lqbot deploy
--all` to rotate every deployable debater in one pass.

## Local Token Copy

Only when explicitly needed for development:

```bash
pnpm lqbot token create --agent <slug> --save-local
pnpm lqbot deploy --agent <slug> --save-local
```

This writes to ignored `.lqbot/tokens/<slug>.token`. Deploy also writes token copies automatically
if Wrangler fails after token generation, so a remotely stored hash is not left without its
plaintext registration token.

## Rules

- Never commit plaintext tokens.
- Never log bearer tokens in application logs.
- If a token is exposed, rotate immediately and update LQ Council.
