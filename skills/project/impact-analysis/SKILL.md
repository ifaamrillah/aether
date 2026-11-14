---
name: impact-analysis
description: Trace the likely impact of a proposed change across code, APIs, data, tests, documentation, operations, and dependent teams. Use for brownfield features, refactoring, migrations, and security remediation.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: project
---

# Impact Analysis

## Objective
Identify change surface and hidden dependencies before implementation so work can be scoped, sequenced, and verified.

## Procedure
1. Read the request, project instructions, architecture docs, ADRs, and relevant recent changes.
2. Trace entry points, call sites, shared modules, public interfaces, persisted data, background jobs, and external integrations.
3. Inspect tests, fixtures, build/deployment configuration, feature flags, and operational runbooks.
4. Identify backward-compatibility, migration, rollout, rollback, security, and observability implications.
5. Separate confirmed dependencies from inferred relationships and cite file paths or symbols.
6. Create a dependency-aware change map with owners, risk levels, and verification needs.
7. Update the analysis when implementation reveals a different impact surface.

## Deliverable
Impact report with affected paths/symbols, API/data dependencies, test/doc/operation impact, risks, migration or rollout notes, and recommended task boundaries.

## Guardrails
- Do not claim a file or module is affected without evidence.
- Do not infer runtime behavior from filenames alone.
- Do not edit implementation during analysis unless separately assigned.
- Treat generated code and vendored dependencies as special ownership boundaries.
