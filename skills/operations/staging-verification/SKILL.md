---
name: staging-verification
description: Verify a deployed candidate in a staging environment using health checks, synthetic journeys, logs, and rollback criteria. Use before production release.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: operations
---

# Staging Verification

## Objective
Establish that a candidate behaves as expected in a representative but non-production environment.

## Procedure
1. Confirm deployment identity, commit/version, environment parity, configuration, and test-data boundaries.
2. Check service health, readiness, startup, dependency connectivity, and telemetry.
3. Run synthetic critical journeys with non-sensitive data and minimum-privilege test identities.
4. Verify migrations, background jobs, queues, webhooks, scheduled tasks, and external integrations where relevant.
5. Inspect logs, traces, error rates, latency, resource usage, and security-relevant events.
6. Exercise rollback or redeploy procedure in a safe environment when required by the release plan.
7. Compare results with agreed thresholds and capture command, time, environment, and evidence.
8. Record go/no-go recommendation and unresolved risks for the release owner.

## Deliverable
Staging verification report with deployed version, environment, health checks, synthetic journey results, telemetry, rollback evidence, and recommendation.

## Guardrails
- Never use production secrets or customer data in staging tests.
- Do not make production changes as part of staging verification.
- Do not call a deployment healthy based on a single HTTP status.
- Do not approve a release when critical checks are inconclusive.
