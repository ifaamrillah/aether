---
name: unit-testing
description: Design and implement fast, isolated tests for pure functions, classes, validators, state machines, and error paths. Use when adding or changing local logic.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: quality
---

# Unit Testing

## Objective
Verify small units deterministically, including boundary conditions and failure behavior.

## Procedure
1. Identify the unit contract, observable outputs, invariants, and error conditions.
2. Use table-driven tests for equivalent input classes and boundary values.
3. Stub external boundaries rather than mocking the implementation under test.
4. Test immutability, ordering, idempotency, invalid input, and exceptional paths where relevant.
5. Use deterministic clocks, identifiers, randomness, and temporary fixtures.
6. Ensure each test would fail for a meaningful regression and does not depend on execution order.
7. Run the focused suite and record the command and result.

## Deliverable
Unit test changes with behavior matrix, relevant commands, pass/fail summary, and uncovered cases.

## Guardrails
- Avoid testing private implementation details when public behavior is sufficient.
- Do not use arbitrary sleeps to handle asynchronous behavior.
- Do not share mutable fixtures across tests without resetting them.
- A passing unit test is not integration or production evidence.
