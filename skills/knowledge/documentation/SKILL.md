---
name: documentation
description: Create or update accurate engineering documentation that remains aligned with the codebase. Use when behavior, APIs, configuration, architecture, operational processes, or user-facing workflows change.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: knowledge
---

# Engineering Documentation

## Objective

Keep essential project knowledge accurate, traceable, and proportionate to the change.

## Procedure

1. Identify which docs, README sections, examples, API references, ADRs, and runbooks are affected.
2. Compare current documentation with actual source, schema, tests, and configuration.
3. Preserve approved requirements and ADRs. Report drift rather than silently rewriting intent.
4. Update the smallest durable set of files.
5. Include tested commands and realistic examples.
6. Link key claims to source files, symbols, schemas, or decisions.
7. Remove stale examples only when the replacement is verified.
8. Review for secrets, private data, internal hostnames, and unsupported claims.

## Deliverable

Summarize:
- Documents updated.
- Code/contracts used as sources.
- Important behavior or configuration documented.
- Known gaps and stale documentation that still needs reconciliation.

## Guardrails

- Do not generate large documentation sets for a trivial change.
- Do not invent behavior or claim a feature exists when it is only planned.
- Do not overwrite approved requirements or ADRs because implementation differs.
- Do not add secrets or environment-specific credentials to examples.
