---
name: testing
description: Design, run, and interpret tests for a code or product change. Use when verifying implementation, diagnosing regressions, defining a test strategy, or preparing evidence for a release.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: quality
---

# Testing and Verification

## Objective

Produce repeatable evidence that the requested behavior works within the verified scope.

## Procedure

1. Map requirements and acceptance criteria to observable checks.
2. Select appropriate levels: unit, integration, contract, end-to-end, visual, accessibility, performance, or security.
3. Add tests for normal behavior, edge cases, failure paths, and previously observed regressions.
4. Prefer deterministic fixtures and isolated temporary project directories.
5. Run the narrowest relevant tests, then package and repository checks.
6. Capture command, tool/version, exit status, summary, and report path.
7. Investigate failures; do not relabel flaky or skipped tests as passing.
8. Review coverage gaps and identify what is not proven.

## Deliverable

Provide a test report that records:
- Test scope and requirements covered.
- Commands and versions.
- Passed, failed, skipped, and inconclusive counts.
- Evidence paths, screenshots/traces where relevant.
- Environment and limitations.
- Outstanding risk.

## Guardrails

- A passing unit test suite does not prove production readiness.
- A screenshot does not prove underlying interaction or accessibility behavior.
- Never fabricate output or claim a test ran when it did not.
- Do not weaken assertions simply to produce a green result.
