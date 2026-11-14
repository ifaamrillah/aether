---
name: implementation
description: Implement an approved and scoped engineering task while preserving repository conventions. Use when a specification and task contract are ready for code changes or a bounded bug fix.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: engineering
---

# Implementation

## Objective

Make the smallest maintainable change that satisfies the task contract and acceptance criteria.

## Procedure

1. Read project instructions, the approved specification, the task handoff, and relevant source/tests.
2. Confirm the intended read/write scope before editing. Stop and report a conflict if required work is outside scope.
3. Trace existing behavior and reuse established abstractions.
4. Implement in small increments. Prefer clear, typed, deterministic code.
5. Add or update tests alongside behavior changes.
6. Run targeted tests first, then relevant package checks.
7. Inspect the final diff for unrelated changes, secrets, generated files, and scope violations.
8. Update durable documentation and examples affected by the change.
9. Produce a task result listing all changed files and evidence paths.

## Completion report

Include:
- What changed and why.
- Files changed.
- Tests/commands actually executed and their exit status.
- Evidence files and what each demonstrates.
- Known limitations and follow-up work.

## Guardrails

- Never claim a test passed unless it was run and its output/exit status was observed.
- Do not weaken tests, remove security checks, disable lint/type checks, or bypass policy to make a change pass.
- Do not modify files outside the declared write scope.
- Do not introduce dependencies without checking project conventions and maintenance/security impact.
- Do not access credentials or perform deployment, migration, deletion, permission, or other high-impact actions without separate authorization.
