# Agent Adapters

Aether adapters translate a portable task contract into platform-aware handoff instructions. They describe platform markers and capabilities without making the core workflow model platform-specific.

## Current adapters

| Adapter | Detection marker | Current handoff mode |
|---|---|---|
| generic | Always available | Human-mediated |
| Claude Code | `.claude/` | Human-mediated |
| Codex | `.agents/` or `.codex/` | Human-mediated |
| OpenCode | `.opencode/` | Human-mediated |
| Gemini CLI | `.gemini/` or `GEMINI.md` | Human-mediated |
| Antigravity | `.agents/`, `AGENTS.md`, or `GEMINI.md` | Human-mediated |

## Capability reporting

The current adapters report:
- Portable Agent Skills: supported.
- Agent handoff documents: supported.
- Native subagent invocation: unsupported.
- Parallel agent execution: unsupported.
- Browser automation: unsupported.
- OS-enforced file-scoped execution: degraded.

A generated handoff is an instruction contract, not a sandbox. Actual filesystem, process, network, deployment, and credential permissions must be enforced by the host platform or execution environment.

## Handoff flow

1. WorkflowRunService exposes ready stages.
2. Core creates a version-pinned StageTaskContract for each ready stage.
3. The adapter renders `HANDOFF.md` and the CLI persists `task.json`.
4. An operator delegates the handoff through the platform's native agent workflow.
5. The agent writes a result JSON and evidence files under the task output directory.
6. `aether workflow accept` validates task identity, write scope, evidence paths, and checksums.
7. WorkflowRunService accepts a stage completion only when the persisted verification manifest and evidence files still match their SHA-256 digests.

## Extension guidance

An adapter must:
- Report capabilities truthfully.
- Keep the portable task contract unchanged.
- Declare platform-specific markers and limitations.
- Never infer a permission from the presence of a project marker.
- Never claim execution, delegation, or approval happened when it only generated instructions.
- Preserve user-owned platform configuration and files.

A future native adapter may add explicit execution capabilities, but it must implement and test the host platform's real invocation and permission semantics.
