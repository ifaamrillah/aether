---
name: e2e-testing
description: Verify complete user journeys through the running application using browser, CLI, or API automation. Use for critical workflows, acceptance testing, and release confidence.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: quality
---

# E2e Testing

## Objective
Confirm that critical user-visible journeys work across integrated components in a realistic but controlled environment.

## Procedure
1. Map acceptance criteria to end-to-end scenarios and prioritize critical user journeys.
2. Prepare isolated data, credentials with minimum privileges, and a known test environment.
3. Exercise normal, negative, permission, recovery, and edge-case flows with stable selectors or APIs.
4. Capture screenshots, browser traces, console/network errors, CLI output, and environment metadata where relevant.
5. Check data persistence and cleanup, not only the immediate UI response.
6. Separate product failures from test-environment or infrastructure failures.
7. Re-run failed scenarios after remediation and record remaining gaps.

## Deliverable
E2E report with journey coverage, environment, browser/CLI versions, executed scenarios, evidence paths, failures, and residual risk.

## Guardrails
- Never use real customer data in test fixtures.
- Do not expose credentials in traces or logs.
- Do not make tests flaky with arbitrary timing or unstable selectors.
- A green smoke test does not prove all user journeys.
