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

## Snapshot and event relationship

Each snapshot records both `last_event_sequence` and `snapshot_sequence`. They must match and identify the final event incorporated into that snapshot.

When the event log contains later events, `loadRun` returns them in `pendingEvents`. `WorkflowRunService.recoverRun` replays only supported, validated run-status and stage-transition events in sequence order, then writes the reconstructed snapshot. Unknown event types or inconsistent payloads stop recovery without discarding the log.

After replay, a running workflow reconciles eligible stages that may not have been promoted before the interruption. Recovery is idempotent: a second recovery with no new events does not append duplicate transitions.

## Example

```ts
import { FileStateStore } from "@aether/core";

const store = new FileStateStore(process.cwd());

const loaded = await store.loadRun("run_01HXYZ");
console.log(loaded.snapshot.status);
console.log(loaded.pendingEvents);
```

Creating a run requires an initial snapshot and its sequence-1 event. Appending events and writing snapshots are separate operations so that callers can define domain-specific transitions. A snapshot may only be written when it incorporates the latest persisted event.

## Recovery boundaries

The event append and snapshot replacement occur under one per-run lock, but they are two durable filesystem writes. A process crash between them can leave a valid event beyond the snapshot sequence. The recovery service can replay supported event types and publish a new snapshot. If the event is malformed or unknown, recovery stops and preserves the event log for inspection.

A hard crash can also leave a stale lock file. Aether does not automatically delete stale locks in this version because PID reuse, shared filesystems, and cross-platform process identity make automatic reclamation unsafe without a stronger lease protocol.

## Current limits

This implementation is local-first and intended for one active writer per run. It is not a distributed lock service, database, or OS sandbox. Recovery is deterministic for the event types emitted by the current WorkflowRunService; unknown event types fail closed.
