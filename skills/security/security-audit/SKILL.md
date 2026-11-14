---
name: security-audit
description: Review an application or change for security weaknesses and define safe remediation. Use for threat modeling, pre-release checks, sensitive data flows, authentication/authorization changes, or security-sensitive code review.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: security
---

# Security Audit

## Objective

Identify realistic security risks, establish their impact, and recommend proportionate remediation using safe, authorized methods.

## Procedure

1. Define assets, trust boundaries, actors, entry points, sensitive data, and deployment context.
2. Inspect authentication, authorization, validation, serialization, file access, network calls, secrets, cryptography, dependencies, logging, and error behavior.
3. Build a lightweight threat model for changed or exposed flows.
4. Check for injection, path traversal, SSRF, insecure deserialization, privilege escalation, data leakage, race conditions, and insecure defaults where relevant.
5. Inspect dependency advisories and supported versions using authoritative sources.
6. Classify findings by severity, exploitability, and affected assets.
7. Propose least-privilege remediations and tests.
8. Re-check the diff after remediation.

## Deliverable

Provide:
- Scope and assumptions.
- Trust-boundary/data-flow summary.
- Findings with severity and evidence.
- Recommended fixes.
- Regression tests.
- Residual risk and approval requirements.

## Guardrails

- Test only systems and environments the operator is authorized to assess.
- Do not exfiltrate data, use real credentials, persist access, or perform destructive exploitation.
- Do not publish secrets or sensitive payloads in reports.
- Never treat a clean dependency scan as proof that application code is secure.
- Production changes and security controls require explicit approval.
