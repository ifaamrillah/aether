# Aether

**An open-source, agent-agnostic AI Engineering Harness.**

Aether helps AI coding agents work through reliable engineering workflows: understand a project, plan changes, implement them, verify evidence, and maintain project knowledge.

Aether is a modular harness, not a replacement agent runtime. It combines portable Agent Skills, declarative workflows, versioned contracts, a lightweight TypeScript CLI, and platform adapters while delegating execution to native platform capabilities.

## Principles

- Modular and composable.
- Agent-agnostic and portable.
- Native-first orchestration.
- Evidence-driven completion.
- Living project knowledge.
- Adaptive workflows.
- Context-efficient retrieval.
- Human approval for high-impact actions.

## Status

Aether is in its foundation and early implementation phase. Planned capabilities are not considered implemented until present and tested.

## Development

Requirements: Node.js 22+ and pnpm 10+.

```bash
pnpm install
pnpm check
```

Validate the starter workflow:

```bash
pnpm --filter @aether/cli build
node apps/cli/dist/index.js workflow validate workflows/feature.yaml
```

## Repository layout

- `apps/cli`: developer interface
- `packages/core`: workflow planning, file-backed run state, and event history
- `packages/schemas`: canonical JSON Schema contracts and structural validation
- `skills`: portable Agent Skills
- `workflows`: declarative workflow definitions
- `docs`: architecture and contributor documentation

## License

MIT. See [LICENSE](LICENSE).
