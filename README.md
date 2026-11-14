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

## Install

After the first public npm release, install the CLI globally:

```bash
npm install --global @aether/cli
aether init --platform codex --platform claude-code
aether doctor
aether workflow list
```

The CLI package includes the maintained skills and workflow bundles. The repository is preparing its first npm release; package publication requires the project maintainer's npm scope and token.

## Development

Requirements: Node.js 22+ and pnpm 10+.

```bash
pnpm install
pnpm check
```

Build and validate the CLI:

```bash
pnpm --filter @aether/cli build
node apps/cli/dist/index.js workflow validate workflows/feature.yaml
```

Initialize a project with portable Agent Skills:

```bash
aether init --platform codex --platform claude-code
aether doctor
```

The installer writes a validated `.aether/config.yaml`, portable skills under the selected platform's discovery directory, and validated workflow definitions under `workflows/aether/`. A checksummed `.aether/managed-files.json` tracks both. It never overwrites untracked skills/workflows or Aether-managed files that have been edited by a user. Use `--dry-run` to preview changes.

Update and uninstall are conservative:

```bash
aether update
aether uninstall
```

Update refreshes unchanged Aether-managed files using the platforms recorded in project config. Uninstall removes only managed files whose checksums still match; project config and user edits are preserved.

Start a local workflow run:

```bash
node apps/cli/dist/index.js workflow list
node apps/cli/dist/index.js workflow run workflows/aether/feature.yaml \
  --input 'feature_description=Add account settings'
```

The CLI persists run state under `.aether/runs/`. It also prepares portable task handoffs for ready stages and verifies agent-submitted results before a stage can complete.

Prepare handoffs for a run:

```bash
node apps/cli/dist/index.js workflow handoff <run-id> --file workflows/aether/feature.yaml --adapter claude-code
```

Each ready stage receives a task contract and `HANDOFF.md` under `.aether/handoffs/<run-id>/<stage-id>/`. Select `generic`, `claude-code`, `codex`, `opencode`, `gemini-cli`, or `antigravity`. These adapters prepare human-mediated handoffs; they do not launch platform agents.

After the agent has worked, create the task result JSON at the path specified by the handoff and attach evidence files inside the project. Accept and verify the result:

```bash
node apps/cli/dist/index.js workflow accept <run-id> \
  --file workflows/aether/feature.yaml \
  --stage discovery \
  --result .aether/handoffs/<run-id>/discovery/result.json
```

Aether checks task identity, write-scope compliance, evidence file existence, project path containment, and SHA-256 checksums. At least one evidence record must report a passed result. A passed verification manifest is persisted under `.aether/verification/`; Core re-checks its checksum, task identity, changed-file scope, and current evidence hashes before a stage can transition to completed.

Hashes prove file integrity, not the truth of an agent's report or that a test command really ran. The current adapter does not independently execute tests.

Use the run ID with `workflow status`, `workflow pause`, `workflow resume --file <workflow-file>`, `workflow recover --file <workflow-file>`, or `workflow cancel`. The workflow file remains in `workflows/aether/` and is updated conservatively by `aether update`.

The current adapters produce portable instructions and collect results. They do not yet execute native subagents, enforce OS-level file permissions, or independently rerun every test command.

Inspect platform adapters and detected project markers with:

```bash
aether platform list
aether platform detect
```

The capability report explicitly shows unsupported features such as native subagent invocation and parallel dispatch.

The adapter registry also declares each host's skill discovery directory. Current defaults are:

| Adapter | Skill directory |
|---|---|
| Generic | `.agents/skills/` |
| Claude Code | `.claude/skills/` |
| Codex | `.agents/skills/` |
| OpenCode | `.opencode/skills/` |
| Gemini CLI | `.gemini/skills/` |
| Antigravity | `.agents/skills/` |

These paths follow the platforms' documented project-level skill discovery conventions: [Claude Code](https://code.claude.com/docs/en/skills), [Codex](https://developers.openai.com/codex/skills), [OpenCode](https://opencode.ai/docs/skills/), [Gemini CLI](https://geminicli.com/docs/cli/skills/), and [Antigravity](https://antigravity.google/docs/skills).

## Repository layout

- `apps/cli`: developer interface
- `packages/core`: workflow planning, file-backed run state, delegation contracts, and evidence verification
- `packages/adapters`: portable handoff adapters for generic agents, Claude Code, Codex, OpenCode, Gemini CLI, and Antigravity
- `packages/schemas`: canonical JSON Schema contracts and structural validation
- `skills`: portable Agent Skills, validated by `aether skill validate`
- `workflows`: declarative workflow definitions
- `docs`: architecture and contributor documentation

## License

MIT. See [LICENSE](LICENSE).
