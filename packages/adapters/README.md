# Agent Adapters

Aether adapters translate a portable task contract into platform-aware handoff instructions. They describe platform markers, skill discovery paths, and capabilities without making the core workflow model platform-specific.

The project installer consumes `skill_install_path` from the adapter descriptor. Do not duplicate host-specific skill directories in the CLI or project setup code.

## Current adapters

| Adapter | Detection marker | Skill discovery directory | Execution mode |
|---|---|---|---|
| generic | Always available | `.agents/skills/` | Handoff only |
| Claude Code | `.claude/` | `.claude/skills/` | Interactive CLI |
| Codex | `.agents/` or `.codex/` | `.agents/skills/` | Interactive CLI |
| OpenCode | `.opencode/` | `.opencode/skills/` | Handoff only |
| Gemini CLI | `.gemini/` or `GEMINI.md` | `.gemini/skills/` | Interactive CLI |
| Antigravity | `.agents/`, `AGENTS.md`, or `GEMINI.md` | `.agents/skills/` | Interactive CLI |

## Capability reporting

The adapters report:
- Portable Agent Skills: supported.
- Agent handoff documents: supported.
- Interactive CLI invocation: supported by Claude Code, Codex, Gemini CLI, and Antigravity.
- Native subagent invocation: unsupported.
- Parallel agent execution: unsupported.
- Browser automation: unsupported.
- OS-enforced file-scoped execution: degraded.

A generated handoff is an instruction contract, not a sandbox. Actual filesystem, process, network, deployment, and credential permissions must be enforced by the host platform or execution environment.

## Handoff flow

1. WorkflowRunService exposes ready stages.
2. Core creates a version-pinned StageTaskContract for each ready stage.
3. The adapter renders `HANDOFF.md` and the CLI persists `task.json`.
4. An operator either delegates the handoff manually or runs `aether workflow launch <run-id> --file <workflow.yaml> --adapter <id> --stage <stage-id>` for a supported interactive CLI adapter.
5. The agent writes a result JSON and evidence files under the task output directory.
6. `aether workflow accept` validates task identity, write scope, evidence paths, and checksums.
7. WorkflowRunService accepts a stage completion only when the persisted verification manifest and evidence files still match their SHA-256 digests.

## Evidence trust boundary

A submitted evidence record with `result: passed` is still an agent/operator assertion. Aether verifies that the referenced file exists, remains inside the declared output scope, is a regular non-symlink file, and still matches its SHA-256 digest. It does **not** execute the claimed test command or independently prove that a test suite passed. Stronger proof requires a trusted test-runner/CI integration that captures the actual command, exit code, tool version, and output as evidence.

## Extension guidance

An adapter must:
- Report capabilities truthfully.
- Keep the portable task contract unchanged.
- Declare platform-specific markers and limitations.
- Never infer a permission from the presence of a project marker.
- Never claim execution, delegation, or approval happened when it only generated instructions.
- Preserve user-owned platform configuration and files.

An interactive adapter must implement `buildLaunch` and declare `execution_mode: interactive-cli`; the shared runner starts the command without a shell and inherits the user's terminal so the host retains its permission prompts. Native subagent and parallel-dispatch capabilities must remain unsupported until their real host APIs are integrated and tested.
