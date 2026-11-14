# Aether Skills

Aether skills use the portable Agent Skills folder format. Each skill has a required `SKILL.md` containing YAML frontmatter (`name` and `description`) followed by Markdown instructions. Optional `references/`, `scripts/`, and `assets/` folders may be added when needed.

## Initial skill catalog

| Skill | Purpose |
|---|---|
| `project-onboarding` | Understand an unfamiliar repository and its conventions |
| `discovery` | Frame user problems, constraints, and outcomes |
| `research` | Research current technical information with traceable sources |
| `specification` | Define testable product and engineering requirements |
| `implementation-planning` | Produce dependency-aware, scoped tasks |
| `implementation` | Execute approved and bounded implementation work |
| `code-review` | Independently review diffs for defects and risk |
| `testing` | Design and run verification with evidence |
| `security-audit` | Assess security risks and safe remediation |
| `documentation` | Keep durable project knowledge aligned with code |
| `skill-creator` | Create portable, auditable skills |
| `skill-evaluator` | Evaluate skill quality, safety, and portability |

## Use

Skills can be read and used independently of the Aether CLI. A compatible agent should load only the skill whose description matches the current task, then follow its procedure and guardrails.

Validate the repository's skills with:

```bash
node apps/cli/dist/index.js skill validate skills
```

The validator checks the current Agent Skills frontmatter contract and does not execute scripts included in a skill.

## Authoring conventions

- Keep `name` equal to the directory name.
- Keep standard fields at the top level; put Aether-specific metadata under `metadata`.
- Keep core instructions concise and move detailed reference material into `references/`.
- Never treat a skill as a security policy or permission boundary.
- Never execute third-party scripts merely because they are bundled with a skill.
