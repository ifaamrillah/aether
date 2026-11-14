# Architecture

Aether is a modular, local-first AI Engineering Harness.

## Layers

1. Developer interface: CLI, skills, workflow entrypoints.
2. Control plane: workflow resolver/engine, state, policy, artifact, task, and context services.
3. Knowledge plane: codebase understanding, retrieval, living documentation, and drift detection.
4. Execution plane: platform-native agent delegation, scripts, tests, and verification.
5. Adapters: translate platform capabilities and installation conventions into portable Aether contracts.

## Architectural boundary

Aether owns workflow definitions, state, contracts, policy decisions, and evidence tracking. The active coding-agent platform remains responsible for its own agent runtime and native subagent execution.

## Design decisions

- Prefer deterministic code for file operations, schema validation, state transitions, locking, and evidence parsing.
- Use LLMs for interpretation, planning, and engineering judgment.
- Treat workflow artifacts as durable sources of truth, not chat history.
- Fall back to sequential execution when a platform lacks parallel delegation.
- Do not treat policy checks as an operating-system sandbox.
