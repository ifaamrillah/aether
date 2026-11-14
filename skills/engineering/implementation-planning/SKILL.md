---
name: implementation-planning
description: Break an approved specification into small, dependency-aware implementation tasks. Use before coding multi-file changes, parallel work, cross-package changes, or work with shared file ownership.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: engineering
---

# Implementation Planning

## Objective

Create an executable plan with clear task boundaries, dependency order, file scope, and verification requirements.

## Procedure

1. Review the approved specification, architecture, ADRs, and current codebase map.
2. Identify the smallest vertical slice that proves the required behavior.
3. Break the work into independently verifiable tasks.
4. Define prerequisites and a DAG; group only genuinely independent tasks into parallel waves.
5. Assign an engineering role and required capabilities separately.
6. Declare read paths, write paths, output paths, and exclusive/shared files.
7. Add measurable acceptance criteria and concrete evidence requirements to every task.
8. Identify schema, migration, compatibility, security, and documentation changes.
9. Define rollback or recovery considerations for stateful changes.
10. Present high-risk decisions and external side effects for human approval.

## Deliverable

A task plan with:
- Task IDs and objectives.
- Dependencies and execution waves.
- Suggested role and capabilities.
- Read/write/output scope.
- Acceptance criteria.
- Verification method and expected evidence.
- Risks and human approval gates.

## Guardrails

- Do not parallelize tasks that write the same files without explicit coordination.
- Avoid broad file ownership such as the whole repository when a narrower scope is possible.
- Do not plan production deployment as an implicit implementation step.
- Do not omit tests or docs from the plan when behavior or contracts change.
