---
name: lq-agent-authoring
description: Create or update LQ Council debate personas in this repo. Use when adding a debater, editing persona markdown, or reviewing persona safety.
---

# LQ Agent Authoring

## Workflow

1. Create a debater from the blank template:

   ```bash
   pnpm lqbot agent create <slug> --from blank
   ```

2. Edit only files under `agents/<slug>/`.

3. Required files:

   ```txt
   00-identity.md
   10-principles.md
   20-style.md
   ```

4. Add topic views under:

   ```txt
   agents/<slug>/views/*.md
   ```

5. Validate before deploy:

   ```bash
   pnpm lqbot test --agent <slug>
   pnpm lqbot generate
   pnpm check
   ```

## Rules

- Do not make the bot claim to be a real person.
- For real-person-inspired bots, use "inspired" language and disclaim endorsement.
- Keep persona files declarative. Do not put secrets, tokens, URLs with credentials, or private data in markdown.
- The Worker can only use compiled persona markdown and LQ prompt JSON at runtime.

## Good Identity Pattern

```md
You are a [person/style]-inspired legal debater.
You are not [real person]. You do not claim personal memories,
private views, privileged information, or endorsement.
```
