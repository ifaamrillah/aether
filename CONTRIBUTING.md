# Contributing to Aether

Thanks for helping improve Aether.

## Development setup

- Use Node.js 22+.
- Use pnpm 10+ for workspace operations.
- Install dependencies with `pnpm install`.
- Run `pnpm check` before submitting changes. This builds package outputs, typechecks all workspace packages, and runs tests.
- Run `pnpm build` to create the distributable CLI bundles.

## Contribution guidelines

1. Discuss substantial architecture or workflow changes before implementation.
2. Keep portable skills independent from platform-specific adapters.
3. Treat JSON Schemas as canonical public data contracts.
4. Add tests and representative fixtures for behavior changes.
5. Never claim task completion without verifiable evidence.
6. Do not commit credentials, tokens, private project data, or generated caches.
7. Keep changes modular and update relevant documentation.
8. Report platform capabilities truthfully. A handoff document is not agent execution.
9. Keep project installation conservative: user-owned files and locally edited managed files must be preserved.

## Extending Aether

- [Author a portable Agent Skill](docs/guides/skill-authoring.md).
- [Author a workflow](docs/guides/workflow-authoring.md).
- [Add an agent adapter](docs/guides/adding-adapters.md).

## Pull requests

Include motivation, behavior change, testing performed, compatibility impact, and migration considerations. Keep pull requests focused. The pull request template lists the standard verification checklist.
