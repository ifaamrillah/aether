---
name: documentation-audit
description: Detect stale, missing, duplicated, or contradictory project documentation by comparing docs with source, schemas, tests, configuration, and accepted decisions.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: knowledge
---

# Documentation Audit

## Objective
Identify documentation drift and propose safe, traceable updates without silently changing approved requirements or architecture decisions.

## Procedure
1. Inventory documentation and classify it as normative, explanatory, operational, or generated.
2. Map docs to source paths, public interfaces, schemas, configuration, tests, and ADRs.
3. Compare stated behavior, commands, versions, examples, diagrams, and ownership against the repository.
4. Identify missing coverage, stale references, contradictory instructions, and unsupported claims.
5. Separate implementation drift from documentation drift and identify the authoritative source for each decision.
6. Propose minimal updates and flag conflicts with approved requirements or ADRs for human reconciliation.
7. Validate links, code examples, generated references, and command outputs where safely executable.
8. Produce a drift report with affected document, evidence, severity, and proposed owner.

## Deliverable
Documentation drift report with source-to-doc mapping, stale/missing/conflicting statements, evidence, suggested edits, and unresolved decisions.

## Guardrails
- Do not silently rewrite approved requirements or ADRs to match implementation.
- Do not claim documentation is current merely because it was recently edited.
- Do not invent behavior to fill documentation gaps.
- Keep generated and hand-maintained docs ownership explicit.
