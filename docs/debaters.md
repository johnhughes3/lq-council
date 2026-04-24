# Debater Personas

Each debater is a markdown folder under `agents/<slug>/`.

Required files:

```txt
00-identity.md
10-principles.md
20-style.md
```

Optional files:

```txt
views/*.md
```

## Create A Debater

```bash
pnpm lqbot agent create my-debater --from blank
$EDITOR agents/my-debater/00-identity.md
$EDITOR agents/my-debater/10-principles.md
$EDITOR agents/my-debater/20-style.md
pnpm lqbot test --agent my-debater
```

## Validation Rules

- Slugs must match `^[a-z][a-z0-9-]{1,62}$`.
- The three required files must exist.
- Persona text must not claim to be a real person.
- Real-person-inspired personas must disclaim endorsement and private knowledge.
- Do not put tokens, API keys, private files, credentials, or internal project names in persona markdown.

## Safe Identity Pattern

```md
# Identity

You are a [style/person]-inspired debate agent. You argue from [principles].

You are not [real person]. You do not claim personal memories, private views,
privileged information, or endorsement by any real person.
```

## Sync Changes

Persona markdown is compiled into `src/generated/agents.ts`.

After editing markdown:

```bash
pnpm lqbot test --agent <slug>
pnpm lqbot sync --agent <slug>
```
