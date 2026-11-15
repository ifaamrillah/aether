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

The CLI persists run state under `.aether/runs/`. For each ready stage, it prepares a portable task handoff plus a bounded `CONTEXT.md` pack of relevant local source/documentation excerpts. The handoff links that context file. Aether verifies agent-submitted results before a stage can complete.

Prepare handoffs for a run:

```bash
node apps/cli/dist/index.js workflow handoff <run-id> --file workflows/aether/feature.yaml --adapter claude-code
```

Each ready stage receives a task contract and `HANDOFF.md` under `.aether/handoffs/<run-id>/<stage-id>/`. Select `generic`, `claude-code`, `codex`, `opencode`, `gemini-cli`, or `antigravity`.

Launch one stage through a supported interactive agent CLI:

```bash
node apps/cli/dist/index.js workflow launch <run-id> \
  --file workflows/aether/feature.yaml \
  --adapter codex \
  --stage discovery
```

Interactive launch is supported for Claude Code, Codex, Gemini CLI, and Antigravity. Aether starts the host CLI without a shell and leaves its normal permission and approval flow in control. Launch one stage per invocation; specify `--stage` when more than one stage is ready or failed. Generic and OpenCode remain handoff-only adapters.

A successful CLI exit does not complete a workflow stage. The stage remains `in_progress` until you inspect the agent's result and evidence, then run `workflow accept` as shown below. Native subagent dispatch and parallel agent execution are not implemented.

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

Interactive adapters can launch the host CLI, but they do not execute native subagents or dispatch parallel workers. Task file scopes remain contracts rather than OS-level permissions, and Aether does not independently rerun every test command.

Inspect platform adapters and detected project markers with:

```bash
aether platform list
aether platform detect
```

The capability report explicitly shows unsupported features such as native subagent invocation and parallel dispatch.

Retrieve bounded local project context for a task:

```bash
node apps/cli/dist/index.js context search "workflow recovery" --limit 5 --max-chars 6000
```

Context search uses deterministic lexical ranking over local text files. It does not create a persistent index, use embeddings, or send project content to a remote service. Common generated directories, binary files, symbolic links, obvious environment/credential files, and oversized content are excluded. The retriever applies root and nested `.gitignore` rules, including common glob, anchored-path, and negation patterns. Hard-coded safety exclusions for environment/credential files, `.aether`, and dependency/cache directories remain excluded even when a negation rule attempts to re-include them. This is still not a secret scanner; review repository and local ignore rules before using it on projects with private local data.

Check local Markdown links and heading references:

```bash
node apps/cli/dist/index.js docs audit
node apps/cli/dist/index.js docs audit --project ../service --max-files 3000
```

The documentation audit checks relative and project-root Markdown destinations, extensionless Markdown routes, and common heading anchors. It skips external URLs and code examples. A non-zero exit indicates a missing local target, missing heading anchor, or an incomplete scan. It does not fetch remote URLs or assess whether documentation statements are semantically correct.

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

## Human approval and trusted reviewer identities

Workflow stages can require a human decision, a cryptographically verified reviewer identity, and role authorization before an agent receives a handoff:

```yaml
stages:
  - id: protected-change
    skill: implementation
    required: true
    approval:
      mode: required
      risk: high
      require_signature: true
      allowed_approvers: [release-maintainer]
      required_roles: [maintainer, security]
      prevent_self_approval: true
```

Create a local Ed25519 key pair and register its public key in the project trust registry:

```bash
aether trust keygen --id release-maintainer
aether trust register --id release-maintainer --public-key .aether/keys/release-maintainer.public.pem --roles maintainer,security
aether trust list
aether trust validate
```

The private key stays in `.aether/keys/` (Git-ignored and written with owner-only permissions). Share and review the public key through `.aether/trust/approvers.json`; never commit or send the private key. Each trusted identity must have a unique ID, an Ed25519 public key, one or more roles, and an active flag.

Approve or reject with the identity ID and its private key:

```bash
aether workflow status <run-id>
aether workflow approve <run-id> --file workflows/feature.yaml --stage protected-change --by release-maintainer --key .aether/keys/release-maintainer.private.pem --reason "Scope reviewed"
aether workflow reject <run-id> --file workflows/feature.yaml --stage protected-change --by release-maintainer --key .aether/keys/release-maintainer.private.pem --reason "Reduce the write scope"
```

The Ed25519 signature covers the approval ID, action digest, decision, reviewer identity, timestamp, reason, and policy version. Core verifies it against the project trust registry during the decision and again during event recovery. Allowlisted identities and required roles are enforced; self-approval is denied by default. Key rotation should use a new identity ID so historic signatures remain verifiable.

Stages using `approval.mode: optional` start normally and can be gated later with `workflow request-approval`. Rejected stages remain blocked until a fresh approval request is made. Unsigned approval remains available only for stages that do not set `require_signature: true`; their `--by` values are audit labels, not authenticated identities.

The trust registry is a project-controlled root of trust: protect changes to it with branch protection and code review. A local attacker who can replace the registry or runtime event log can undermine local verification. These gates do not provide OS isolation, deployment credentials, or an external identity provider.

See [Approval gates](docs/architecture/approval-gates.md) for lifecycle details and trust boundaries.
## UI design workflow

For a UI change that needs explicit design work before engineering specification, use the dedicated UI Improvement workflow. Validate and run workflows/ui-improvement.yaml with the desired UI change as the ui_change input.

It requires UI/UX research, design-system definition, wireframing, and a reviewable prototype before specification. Visual testing and accessibility audit follow implementation. Use the agent-orchestration skill for native subagent coordination when the active host exposes that capability; otherwise the workflow can be performed sequentially.

See docs/guides/ui-improvement-workflow.md.

## Repository layout

- `apps/cli`: developer interface
- `packages/core`: workflow planning, file-backed run state, local context retrieval, delegation contracts, and evidence verification
- `packages/adapters`: portable handoff adapters for generic agents, Claude Code, Codex, OpenCode, Gemini CLI, and Antigravity
- `packages/schemas`: canonical JSON Schema contracts and structural validation
- `skills`: portable Agent Skills, validated by `aether skill validate`
- `workflows`: declarative workflow definitions
- `docs`: architecture and contributor documentation

## License

MIT. See [LICENSE](LICENSE).
