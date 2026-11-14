# Workflow Recovery and CLI Lifecycle

## Lifecycle commands

The initial CLI exposes the persisted run lifecycle:

```bash
aether workflow run workflows/feature.yaml --input 'feature_description=Build account settings'
aether workflow status <run-id>
aether workflow pause <run-id>
aether workflow resume <run-id> --file workflows/feature.yaml
aether workflow recover <run-id> --file workflows/feature.yaml
aether workflow cancel <run-id>
```

Input values after `--input` use YAML scalar parsing, so strings, booleans, numbers, arrays, and objects are converted before Core validates them against the workflow input definitions.

The project ID defaults to the current working directory name. `--project-id` can override it when creating a run.

## Run and resume behavior

- `run` validates the workflow, validates inputs, creates the run, and starts its lifecycle.
- `status` reads the materialized snapshot and reports any events not yet incorporated into it.
- `pause` changes a running run to paused without discarding the current stage states.
- `resume` loads the supplied workflow definition, verifies the pinned ID/version, attempts event recovery, and resumes only a paused run.
- `recover` replays pending supported events but does not automatically change a paused run to running.
- `cancel` makes a non-terminal run terminal.

The CLI does not execute platform agents yet. It prepares and persists eligible stage states; native delegation adapters will be connected in a later milestone.

## Recovery algorithm

1. Load the snapshot and append-only event log under the FileStateStore's per-run read lock.
2. Select events after the snapshot sequence.
3. Verify contiguous sequence, timestamp, event identity, and supported event type.
4. Replay run-status changes only when their recorded prior status matches the reconstructed state.
5. Replay stage transitions through the canonical stage transition state machine.
6. Validate stage dependencies and skip restrictions for replayed transitions.
7. For a completion event, revalidate the persisted verification manifest and its evidence checksums.
8. Write the reconstructed snapshot only after the complete pending event batch has replayed successfully.
9. If the resulting run is running, reconcile eligible pending stages that were not promoted before interruption.

The reducer is intentionally strict. Unknown event types, malformed payloads, or impossible transitions stop recovery without changing the stored snapshot or deleting event history.

## Guarantees and limitations

Recovery is idempotent for the currently supported event types. It does not provide a multi-file filesystem transaction: an event is fsynced before its snapshot is replaced. A hard process crash can leave a stale lock file; automatic stale-lock reclamation is not implemented. Operators must inspect such locks rather than have Aether guess that the process is dead.
