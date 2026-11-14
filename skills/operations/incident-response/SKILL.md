---
name: incident-response
description: Triage and coordinate a software or security incident while preserving evidence, minimizing harm, and keeping an accountable human incident commander in control.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: operations
---

# Incident Response

## Objective
Support rapid, evidence-based incident response without destroying forensic information or making unauthorized changes.

## Procedure
1. Confirm the incident signal, severity, affected services, time window, and incident commander.
2. Preserve relevant logs, traces, deployment records, and evidence with timestamps and access controls.
3. Establish impact, scope, affected users/data, current mitigations, and uncertainty.
4. Recommend containment options with blast radius, reversibility, and approval needs.
5. Coordinate investigation tasks with clear ownership and non-overlapping scopes.
6. Track timeline, hypotheses, confirmed facts, decisions, and external communications.
7. Verify recovery against service-level indicators and user-visible critical journeys.
8. Prepare a post-incident review with root cause, contributing factors, corrective actions, owners, and deadlines.

## Deliverable
Incident record with severity, timeline, scope, preserved evidence, containment decisions, recovery checks, communications owner, and corrective actions.

## Guardrails
- Do not delete logs, rotate credentials, disable controls, or change production without authorization.
- Do not speculate publicly about root cause or attribution.
- Do not include secrets or personal data in general incident notes.
- Keep an explicit distinction between confirmed facts and hypotheses.
