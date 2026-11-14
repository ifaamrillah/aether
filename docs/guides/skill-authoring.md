# Authoring Portable Agent Skills

Aether skills use the portable Agent Skills directory format. A skill must remain usable without the Aether CLI or a platform-specific runtime.

## Minimal structure

```text
skills/
└── engineering/
    └── my-skill/
        ├── SKILL.md
        ├── references/
        ├── scripts/
        └── assets/
```

Only `SKILL.md` is required. Add other folders only when they materially improve the procedure.

## SKILL.md

Use YAML frontmatter with a stable directory-matching `name` and a task-specific `description`.

```markdown
---
name: my-skill
description: Use when a developer needs to perform a specific engineering task.
---

# My Skill

## Purpose

State the result this skill should produce.

## Procedure

1. Inspect the relevant project context.
2. Follow the repository's conventions.
3. Produce the expected artifact or change.
4. Verify the result and report evidence.

## Guardrails

- Respect project instructions and user constraints.
- Do not claim a tool or test ran unless it actually ran.
- Ask for approval before high-impact or destructive operations.
```

Keep the core procedure concise. Move detailed material to `references/` and link it from `SKILL.md`. Scripts are source material and must not be executed merely because they are present.

## Quality requirements

- Use specific activation descriptions rather than vague role descriptions.
- State inputs, outputs, procedure, and completion criteria.
- Include safety boundaries and uncertainty handling.
- Avoid assumptions about a specific agent platform.
- Keep instructions self-contained enough to be useful without the Aether CLI.
- Do not encode security policy as prompt text alone.

## Validate and test

```bash
pnpm build
node apps/cli/dist/index.js skill validate skills
pnpm test
```

Add fixtures and evaluator scenarios when behavior changes. A passing structural validator does not prove that a skill performs well; substantive skills should also be evaluated with representative tasks, edge cases, and unsafe-input scenarios.

See the `skill-creator` and `skill-evaluator` skills for the current authoring workflow.
