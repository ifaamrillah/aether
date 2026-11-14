---
name: remediation
description: Plan and implement fixes for validated security findings with minimal scope, regression coverage, and explicit risk tracking. Use after a security audit or incident investigation.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: security
---

# Remediation

## Objective
Resolve security findings without broadening access, weakening controls, or introducing regressions.

## Procedure
1. Confirm the finding, affected assets, reproduction conditions, severity, and source evidence.
2. Map the finding to owning code, configuration, dependencies, and trust boundaries.
3. Choose a mitigation that follows least privilege and fails safely.
4. Write regression tests that demonstrate the vulnerability before the fix where safe and prove the corrected behavior.
5. Implement the smallest practical change and update relevant configuration or documentation.
6. Run targeted tests, security checks, and relevant integration tests.
7. Reassess residual risk, compatibility, migration, and rollout implications.
8. Record the fix, owner, evidence, and any accepted exception.

## Deliverable
Remediation record with finding reference, changed paths, mitigation, regression tests, verification results, residual risk, and rollout guidance.

## Guardrails
- Do not exploit production systems or expose sensitive proof-of-concept data.
- Do not silently downgrade severity or close a finding without evidence.
- Do not weaken authentication, authorization, validation, or audit controls to make tests pass.
- Require explicit approval for production changes or emergency overrides.
