# File-backed Run State

Aether's first persistence implementation is provided by `FileStateStore` in `@aether/core`.

## On-disk layout

For a project root at `<project-root>`, runs are stored under:

```text
.aether/
└── runs/
    ├── <run-id>.lock
    └── <run-id>/
        ├── run.json
        └── events.jsonl
```

- `run.json` is the latest materialized workflow-run snapshot.
- `events.jsonl` is an append-only, newline-delimited event history.
- `<run-id>.lock` is an exclusive writer/reader coordination lock.

Runtime state is ignored by Git by default. Approved project knowledge and durable engineering artifacts remain separate from ephemeral run state.

## Store guarantees

- Run IDs are validated before they are used in filesystem paths.
- A new run is prepared in a temporary directory and published by directory rename.
- Snapshot updates use a temporary file, fsync, and atomic rename.
- Event appends are serialized per run and fsynced before returning.
- Event sequence numbers must be contiguous and monotonic.
- Duplicate event IDs and mismatched run IDs are rejected.
- Only one process can hold a run lock at a time.

A lock conflict raises `RunLockedError`. The initial implementation does not automatically reclaim stale locks; recovery must be an explicit future operation rather than assuming a lock is abandoned.

## Stage lifecycle state machine

The pure `transitionStageState` helper is the canonical guard for stage status changes. It validates the allowed transition table, validates the event sequence and timestamp, and returns a new stage-state object without mutating the input.

| Current status | Allowed next statuses |
|---|---|
| pending | ready, skipped |
| ready | in_progress, awaiting_approval, blocked, skipped |
| in_progress | verifying, blocked, failed |
| awaiting_approval | ready, blocked, failed |
| verifying | completed, blocked, failed |
| blocked | ready, failed |
| failed | ready, blocked |
| completed | stale |
| skipped | stale |
| stale | ready, skipped |

A transition to `blocked` requires a non-empty reason. Starting execution increments the attempt counter and records `started_at`. Completion records `completed_at`. Retrying a failed or stale stage must pass through `ready` before execution starts again.

This helper validates one stage transition; it does not persist the associated event or snapshot. A workflow-run service will coordinate state changes with the append-only event log in a subsequent increment.

## Snapshot and event relationship

Each snapshot records both `last_event_sequence` and `snapshot_sequence`. They must match and identify the final event incorporated into that snapshot.

When the event log contains later events, `loadRun` returns them in `pendingEvents`. This makes the gap explicit to a recovery layer; the current store does not silently replay arbitrary event payloads into state.

## Example

```ts
import { FileStateStore } from "@aether/core";

const store = new FileStateStore(process.cwd());

const loaded = await store.loadRun("run_01HXYZ");
console.log(loaded.snapshot.status);
console.log(loaded.pendingEvents);
```

Creating a run requires an initial snapshot and its sequence-1 event. Appending events and writing snapshots are separate operations so that callers can define domain-specific transitions. A snapshot may only be written when it incorporates the latest persisted event.

## Current limits

This implementation is local-first and intended for one active writer per run. It is not a distributed lock service, database, OS sandbox, or complete crash-recovery engine. Future work will add domain-level run transition validation, schema validation of persisted records, stale-lock recovery, event replay policies, and CLI commands for run creation/status/resume.
