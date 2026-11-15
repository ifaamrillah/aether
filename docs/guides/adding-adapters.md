# Adding an Agent Adapter

Adapters describe real host capabilities and translate portable task contracts into platform-aware handoffs. The workflow model and task contract must not become platform-specific.

## Implement an adapter

1. Add the adapter ID to `AdapterId` in `packages/adapters/src/types.ts`.
2. Add its descriptor in `packages/adapters/src/adapter.ts`.
3. Declare platform markers and its project-level `skill_install_path`.
4. Report each capability truthfully as `native`, `supported`, `degraded`, or `unsupported`.
5. Implement project detection and handoff rendering.
6. For interactive CLI support, add a `buildLaunch` implementation that returns an argument array and permission notes; do not construct shell command strings.
7. Update `packages/schemas/json-schema/adapter.schema.json` only when the public contract changes.
8. Add tests for descriptor validity, detection, paths, output rendering, launch arguments, and unsupported capabilities.
9. Update the adapter reference and CI fixtures.

## Capability principles

- Detecting a folder does not prove that a runtime API is available.
- A generated `HANDOFF.md` is not the same as invoking an agent.
- Communicating file scope does not enforce filesystem permissions.
- Native parallel execution must only be reported when it is actually integrated and tested.
- Platform approval semantics must not be inferred from generic prompts.

All adapters keep the `human-mediated` handoff contract. Selected adapters additionally start an interactive host CLI through the shared process runner; this is not native subagent dispatch. Use `shell: false`, preserve host permission prompts, and test the actual command/argument contract. Native subagents, cancellation APIs, enforced file boundaries, and parallel execution remain unsupported until each behavior has integration tests against the host platform.

## Validate

```bash
pnpm typecheck
pnpm test
pnpm build
node apps/cli/dist/index.js platform list
```
