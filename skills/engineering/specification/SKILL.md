---
name: specification
description: Convert an approved problem statement into a testable product and engineering specification. Use before planning or implementing a new feature, API, workflow, or significant behavior change.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: engineering
---

# Engineering Specification

## Objective

Define what must be built and how success will be verified, without prematurely prescribing unnecessary implementation detail.

## Procedure

1. Link the specification to the discovery record and any user-approved requirements.
2. Describe scope, users, use cases, and expected behavior.
3. Define functional and non-functional requirements.
4. Specify inputs, outputs, state changes, errors, permissions, and edge cases.
5. Define data and API contracts where relevant, including compatibility and migration behavior.
6. Identify privacy, security, accessibility, reliability, and performance requirements.
7. Write acceptance criteria that can be verified.
8. Record open questions, assumptions, dependencies, and explicit non-goals.
9. Review the specification for contradictions and ambiguity.

## Deliverable

A versioned specification containing:
- Context and goals.
- In-scope and out-of-scope behavior.
- User scenarios and functional requirements.
- Contracts and state transitions.
- Error and edge-case behavior.
- Non-functional and security requirements.
- Acceptance criteria.
- Dependencies and unresolved decisions.

## Guardrails

- Requirements must be traceable to user input, existing behavior, standards, or an explicitly labeled assumption.
- Do not silently change approved requirements. Record proposed amendments and request approval for material scope changes.
- Avoid specifying internal architecture unless the requirement demands it.
- Do not claim acceptance criteria are met before independent verification.
