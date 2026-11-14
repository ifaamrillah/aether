---
name: production-release
description: Prepare and supervise an explicitly approved production release using a reviewed runbook, health gates, and rollback plan. Use only when the release owner has authorized the exact change and window.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: operations
---

# Production Release

## Objective
Ensure production releases are deliberate, observable, reversible where possible, and controlled by an accountable human owner.

## Procedure
1. Verify written approval for the exact version, target environment, release window, and change scope.
2. Confirm staging evidence, security review, migration plan, dependency readiness, monitoring, and on-call ownership.
3. Review pre-deployment state, backup/restore readiness, feature flags, and rollback/forward-fix decision criteria.
4. Execute only the approved runbook through authorized deployment tooling; stop on unexpected prompts or scope changes.
5. Monitor health, errors, latency, queue depth, data integrity, and critical user journeys against predefined gates.
6. Pause or roll back when thresholds are crossed or evidence becomes inconclusive.
7. Record operator, timestamps, version, commands, approvals, results, and any deviations.
8. Complete post-release validation and hand off outstanding risks to the service owner.

## Deliverable
Production release record with approver, release identity, runbook reference, health gates, operator actions, verification evidence, rollback outcome, and follow-up tasks.

## Guardrails
- Never deploy or change production without explicit, scoped human approval.
- Do not bypass branch protection, security controls, or change-management gates.
- Do not improvise destructive database operations or expose production data.
- Do not claim rollback succeeded without checking system health and data consistency.
