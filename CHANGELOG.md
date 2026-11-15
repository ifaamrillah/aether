# Changelog

All notable changes to Aether are documented here.

## 0.1.0 — Initial public foundation (unreleased)

### Added

- Modular TypeScript monorepo and CLI.
- Portable Agent Skills bundle and skill validation.
- Versioned JSON Schema contracts.
- Workflow definitions, dependency validation, and execution planning.
- File-backed workflow run state, event history, and supported event recovery.
- Stage lifecycle state machine.
- Human-mediated agent handoff contracts and evidence-based result verification.
- Interactive CLI launch for Claude Code, Codex, Gemini CLI, and Antigravity with host-managed permission prompts.
- Required and optional workflow approval gates with digest-bound records, externally trusted Ed25519 approver keys, role checks, signed decision receipts, and event-history recovery.
- Bounded local project-context search with deterministic lexical ranking and safety limits.
- Generic, Claude Code, Codex, OpenCode, Gemini CLI, and Antigravity adapter descriptors.
- Conservative project initialization, update, doctor, and uninstall operations.
- Workflow bundle installation, listing, and validation.
- CI coverage for typecheck, tests, build, project setup, workflow lifecycle, and package tarball smoke tests.

### Limitations

- Platform adapters prepare human-mediated handoffs; they do not invoke native subagents.
- Parallel agent execution is not implemented.
- Evidence checks verify file integrity and declared results, not the truth of an agent report or whether a test command actually ran.
- Requester labels remain unauthenticated audit metadata. Approver identity and roles are verified from an external public-key registry; authentication before signing remains the responsibility of the external identity/approval service. Separation of duties, quorum approval, OIDC integration, and external policy engines are not implemented.
- Automated documentation drift detection, context retrieval, browser automation, and production release/deployment orchestration remain future work.
