# LQ Debate Agent Instructions

This repo is a TypeScript Cloudflare Workers template for LegalQuants LQ Council debate agents.

## Commands

- Install with `pnpm install`.
- Generate bundled persona content with `pnpm lqbot generate`.
- Validate a debater with `pnpm lqbot test --agent <slug>`.
- Deploy with `pnpm lqbot deploy --agent <slug>`.
- Sync persona changes with `pnpm lqbot sync --agent <slug>`.
- Rotate a bearer token with `pnpm lqbot token rotate --agent <slug>`.
- Run all gates with `pnpm check`.

Use pnpm only. Do not use npm or yarn.

## Security Rules

- Never commit `.env`, `.dev.vars`, `.lqbot`, Wrangler state, bearer tokens, or provider API keys.
- Production secrets must be stored through `wrangler secret put` or the CLI wrapper.
- Store only SHA-256 token hashes remotely.
- Do not add filesystem, shell, email, calendar, deployment, or write-capable tools to debate rounds.
- Optional remote MCP tools must be HTTPS, read-only, explicitly allowlisted, and capped.
- The deployed Worker must only use compiled persona markdown, request JSON, remote secrets, and the
  cost ledger. It must not read arbitrary repo files at runtime.
- Do not make persona bots claim to be real living people or imply endorsement by real people.

## Debater Rules

Each debater lives under `agents/<slug>/` and must include:

- `00-identity.md`
- `10-principles.md`
- `20-style.md`
- optional `views/*.md`

After editing persona markdown, run:

```bash
pnpm lqbot test --agent <slug>
pnpm lqbot sync --agent <slug>
```

## Code Quality

Run before handoff:

```bash
pnpm check
```

Coverage gates are enforced in `vitest.config.ts`.
