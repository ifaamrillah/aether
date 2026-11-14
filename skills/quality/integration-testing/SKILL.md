---
name: integration-testing
description: Verify interactions between modules, filesystem state, databases, APIs, queues, adapters, or package boundaries. Use when behavior crosses a component boundary.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: quality
---

# Integration Testing

## Objective
Prove that collaborating components exchange the expected contracts and handle failures consistently.

## Procedure
1. Identify the integration boundary and contract being verified.
2. Use isolated temporary resources and deterministic fixtures; avoid production credentials and data.
3. Exercise realistic success, invalid input, timeout, retry, partial failure, and cleanup paths.
4. Validate serialization, schema compatibility, ordering, persistence, and idempotency as applicable.
5. Capture tool versions, environment, command, output, and cleanup status.
6. Check that tests do not depend on live third-party systems unless explicitly marked and gated.
7. Run the integration suite and summarize environmental limitations.

## Deliverable
Integration test report with boundary, fixtures, scenarios, command/results, evidence paths, and known external dependencies.

## Guardrails
- Do not let integration tests mutate shared production resources.
- Do not silently skip external-service tests and report the whole suite as fully covered.
- Do not use brittle real network dependencies for tests that can use a local test server.
- Clean up temporary resources even when assertions fail.
