---
name: code-review
description: Independently review a change for correctness, regressions, security, maintainability, and missing tests. Use after implementation, before merge, or when reviewing a pull request or agent-produced diff.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: engineering
---

# Code Review

## Objective

Find material defects in the diff, prioritizing user impact and evidence over stylistic preference.

## Procedure

1. Read the task, approved requirements, architecture decisions, and acceptance criteria.
2. Inspect the complete diff and relevant surrounding code.
3. Trace changed behavior through callers, data boundaries, error paths, and state transitions.
4. Check input validation, authorization, secret handling, path boundaries, injection risks, concurrency, and failure recovery where relevant.
5. Evaluate test coverage for normal, boundary, failure, and regression cases.
6. Check API/schema compatibility, migrations, logging, performance, accessibility, and docs as applicable.
7. Verify that claimed test results correspond to actual CI or command evidence.
8. Report findings by severity with concrete file/line references and reproduction or reasoning.

## Findings format

For each finding include:
- Severity: critical, high, medium, or low.
- Location.
- What can go wrong.
- Why it matters.
- Reproduction or evidence.
- Suggested correction.

## Guardrails

- Do not report personal style preferences as defects.
- Do not assume code is safe because tests pass.
- Do not approve a change solely from an agent's self-review.
- Do not modify code during a review unless the task explicitly includes remediation.
