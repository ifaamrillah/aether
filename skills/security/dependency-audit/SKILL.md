---
name: dependency-audit
description: Assess direct and transitive dependencies for advisories, maintenance, license, provenance, and upgrade risk. Use before releases or when adding/updating packages.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: security
---

# Dependency Audit

## Objective
Identify dependency risk using current, traceable package and advisory information and recommend safe remediation.

## Procedure
1. Inventory direct and transitive dependencies, lockfiles, runtime versions, and package-manager configuration.
2. Query authoritative advisory databases and package maintainer/security advisories for the resolved versions.
3. Review maintenance signals, release cadence, deprecation, provenance, supported runtimes, and transitive exposure.
4. Check licenses against the project's policy and identify packages without reliable license metadata.
5. Distinguish vulnerable reachable code from merely present packages where evidence supports that analysis.
6. Prioritize findings by exploitability, severity, reachability, exposure, and fix availability.
7. Recommend minimal upgrades or replacements and identify breaking-change and migration risks.
8. Re-run lockfile, build, type, test, and package checks after approved updates.

## Deliverable
Dependency audit with package/version, source/advisory, severity, reachability evidence, license findings, proposed fix, migration risks, and verification.

## Guardrails
- Do not claim a dependency is safe merely because no advisory was found.
- Do not install or execute untrusted packages during analysis.
- Do not upgrade major versions without compatibility review.
- Do not copy tokens or private registry credentials into reports.
