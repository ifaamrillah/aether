# Agent Delegation and Result Verification

## Purpose

The delegation layer connects Aether's workflow stages to coding agents without replacing the agent platform's runtime. It can prepare portable human-mediated handoffs for all adapters and launch one selected interactive CLI session for Claude Code, Codex, Gemini CLI, or Antigravity. Generic and OpenCode remain handoff-only. Native subagent dispatch and parallel agent execution remain unsupported.

## Stage task contract

For each stage in `ready` state, Core creates a stable task contract containing:
- Run and workflow identity, including the pinned workflow version.
- Stage ID, task ID, objective, and suggested role.
- Task dependencies.
- Declared read and write paths.
- Task-specific output directory.
- Acceptance criteria.
- Expected result file location.

Task IDs are deterministic within a run: `task_<run-id>_<stage-id>`.

## File scope

Workflow stages can declare `scope.read_paths` and `scope.write_paths`. The current verifier supports exact path matches and directory patterns ending in `/**`.

The task output directory is separate from source write scope:

```text
.aether/handoffs/<run-id>/<stage-id>/
├── task.json
├── HANDOFF.md
├── result.json
└── output/
    └── evidence files
```

The output directory is reserved for task reports and evidence; it does not authorize changing source files. Handoff instructions are not an OS sandbox. Host permissions must enforce real write boundaries.

## Result submission

The agent writes a JSON document matching `task-result.schema.json`. It identifies the task, run, and stage; summarizes the work; lists changed files; and references evidence.

Evidence must:
- Exist as a non-empty regular file.
- Resolve inside the project root after symlink resolution.
- Be within this task's output directory.
- Have a supported evidence type.
- Report `passed` or `informational`; at least one record must report `passed`.

Aether computes SHA-256 and byte size for evidence files. Changed files must exist and match the declared write scope. Deleted files and arbitrary glob semantics are not supported by this initial verifier.

## Accepting a task

```bash
aether workflow handoff <run-id> --file workflows/feature.yaml --adapter generic

aether workflow launch <run-id> --file workflows/feature.yaml --adapter codex --stage discovery

aether workflow accept <run-id> \
  --file workflows/feature.yaml \
  --stage discovery \
  --result .aether/handoffs/<run-id>/discovery/result.json
```

Acceptance writes a verification manifest to `.aether/verification/<run-id>/<stage-id>.json`.

WorkflowRunService then independently re-checks:
- The manifest checksum.
- Exact task, run, and stage identity.
- A non-empty summary and evidence list.
- Changed file scope and project containment.
- Evidence location, file type, byte size, and current checksum.
- At least one passing evidence record.

Only then may the stage transition to `completed`. A stale, tampered, out-of-scope, missing, or malformed evidence file prevents completion.

## Trust boundaries and limitations

- Agent-produced summaries and evidence descriptions are untrusted claims.
- Hashes prove file identity/integrity after verification; they do not prove the semantics of a test report or that an external command genuinely ran.
- The current verifier does not independently execute tests or parse arbitrary test-runner output.
- Selected adapters can start an interactive host CLI, but Aether does not dispatch native subagents or enforce OS-level permissions.
- The CLI should be used with trusted repository state and platform permission controls.
- Production deployments, destructive operations, and credential access require separate policy and approval controls.
