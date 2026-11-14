---
name: release-engineering
description: Prepare a reproducible software release with synchronized versions, changelog, artifacts, compatibility checks, and rollback notes. Use for release candidates and package publication readiness.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: operations
---

# Release Engineering

## Objective
Produce a release candidate that is traceable, reproducible, and ready for maintainer approval.

## Procedure
1. Confirm release scope, target version, supported platforms, and release policy.
2. Review merged changes, breaking changes, migrations, deprecations, and security advisories.
3. Verify version consistency across workspace packages, manifests, lockfiles, and generated metadata.
4. Update changelog and user-facing migration/release notes.
5. Run formatting, typecheck, unit, integration, end-to-end, security, package, and compatibility checks that apply.
6. Build distributable artifacts and inspect their contents in a clean consumer environment.
7. Verify license, provenance, source links, release assets, and publication configuration.
8. Prepare release notes, artifact checksums, rollback guidance, and outstanding risks for approval.

## Deliverable
Release readiness report with version, scope, package inventory, test evidence, artifact checksums, compatibility notes, risks, and rollback plan.

## Guardrails
- Do not publish packages or create release tags without maintainer approval.
- Do not expose registry tokens or signing keys.
- Do not claim reproducible builds unless independently repeated.
- Do not skip required migrations or compatibility checks to meet a release date.
