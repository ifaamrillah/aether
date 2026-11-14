---
name: skill-creator
description: Create or revise a portable Agent Skill with clear triggers, safe procedures, and testable outputs. Use when adding a new skill, splitting an oversized skill, or adapting a capability into the standard SKILL.md format.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: meta
---

# Skill Creator

## Objective

Create a small, auditable, reusable skill that agents can discover and load progressively.

## Procedure

1. Define the capability and the exact situations in which it should activate.
2. Name the skill with lowercase letters, numbers, and single hyphen separators; match the containing directory.
3. Write YAML frontmatter with required `name` and `description`. Add only standard optional fields such as `license`, `compatibility`, `metadata`, and experimental `allowed-tools`.
4. Put project-specific metadata under `metadata` with string values.
5. Write concise instructions with objective, procedure, deliverable, and guardrails.
6. Move detailed domain references to a one-level-deep `references/` folder.
7. Avoid platform-specific assumptions unless compatibility requirements explicitly state them.
8. Add positive, negative, and boundary evaluation cases.
9. Validate the frontmatter, directory name, referenced files, and body.
10. Review for unsafe permissions, executable scripts, secret handling, and overlap with existing skills.

## Evaluation checklist

- Trigger description says what the skill does and when to use it.
- Name matches the containing folder and conforms to the format.
- The body is actionable, concise, and structured.
- Inputs, outputs, and stopping conditions are clear.
- Risks and human approval gates are explicit.
- No unverified claims or hidden tool requirements.
- Tests cover activation, non-activation, and failure conditions.

## Guardrails

- Do not put Aether-specific metadata in non-standard top-level frontmatter fields.
- Do not add scripts that run automatically merely because they are present.
- Never encode a skill as a security policy or give it authority to override higher-level controls.
- Avoid copying proprietary or copyrighted instruction sets from other projects.
