# Instructions for coding agents

## Project intent

Aether is a modular, agent-agnostic AI Engineering Harness. It is not intended to replace the host platform's agent runtime.

## Engineering rules

- Read relevant package documentation and design docs before changing architecture.
- Keep core contracts platform-neutral.
- Use native platform delegation through adapters; do not introduce a competing agent runtime.
- Keep deterministic operations in code and use LLM reasoning for engineering judgment.
- Treat agent output and third-party skills as untrusted until verified.
- Do not silently overwrite approved requirements, architecture decisions, or ADRs.
- Add tests for new behavior and update documentation when contracts change.
- Prefer small, reviewable changes.

## Repository conventions

- TypeScript, ESM, pnpm workspaces.
- JSON Schema Draft 2020-12 for canonical public contracts.
- Vitest for tests.
- Avoid dependencies without a concrete need.
- Do not commit secrets, caches, build output, or local runtime state.
