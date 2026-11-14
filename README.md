# Aether

**An open-source, agent-agnostic AI Engineering Harness.**

Aether helps AI coding agents work through reliable engineering workflows: discover a project, understand requirements, plan changes, implement them, verify evidence, and maintain project knowledge.

Aether is a modular harness—not a replacement agent runtime. It combines portable Agent Skills, declarative workflows, versioned contracts, a lightweight TypeScript CLI, and platform adapters while delegating actual agent execution to native platform capabilities.

## Design principles

- **Modular and composable:** use the pieces a project needs.
- **Agent-agnostic:** keep workflows and contracts portable across coding agents.
- **Native-first orchestration:** use platform-native delegation where available.
- **Evidence-driven:** completion requires verifiable outputs, not just an agent's claim.
- **Living knowledge:** keep approved specifications, decisions, and docs aligned with code.
- **Adaptive:** select workflows based on intent, risk, and complexity.
- **Context-efficient:** retrieve only the information needed for each task.
- **Human-controlled autonomy:** require approval for high-impact actions.

## Repository status

Aether is in its **foundation / early implementation** phase. Interfaces and schemas are evolving. Do not treat planned capabilities as implemented until they are present and covered by tests.

## Architecture

```text
apps/cli/          Local developer interface
packages/core/     Workflow, state, policy, and artifact services
packages/schemas/  Canonical JSON Schema contracts
packages/adapters/ Agent platform integrations
skills/            Portable Agent Skills
workflows/         Declarative workflow definitions
templates/         Artifact templates
evals/             Skill and workflow evaluations
docs/              Architecture and contributor documentation
```

## Getting started

Requirements: Node.js 22+ and pnpm 10+.

```bash
pnpm install
pnpm build
pnpm test
```

The CLI is under active development. Its commands and configuration format will be documented as they become available.

## Project documentation

- [Architecture](docs/architecture/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
