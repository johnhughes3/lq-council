---
name: lq-sync-persona
description: Sync debater markdown changes into the deployed Worker.
---

# LQ Persona Sync

## When To Use

Use after editing files under:

```txt
agents/<slug>/
```

## Sync

```bash
pnpm lqbot test --agent <slug>
pnpm lqbot sync --agent <slug>
```

`sync` regenerates `src/generated/agents.ts`, runs quality gates unless `--skip-check` is passed,
and redeploys the Worker.

## Notes

- Runtime Workers do not read `agents/` from disk.
- Markdown changes must be regenerated before deploy.
- Keep persona markdown public-safe; this repo is intended to be publishable.
