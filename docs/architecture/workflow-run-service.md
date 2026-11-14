# Workflow Run Service

WorkflowRunService is the application service that creates and advances a workflow run. It coordinates workflow semantics, stage lifecycle transitions, the file-backed state store, and the append-only event log.

## Responsibilities

- Validate the workflow dependency graph before creating a run.
- Validate provided inputs, defaults, and unknown input keys.
- Pin a run to a workflow ID and version.
- Initialize all stage states as pending.
- Start a run and mark dependency-free stages as ready.
- Promote stages on required completion paths only after all their dependencies are completed.
- Apply stage changes through the canonical stage transition state machine.
- Update the run status from required completion stages and blocking states.
- Persist each event and its corresponding snapshot under one per-run store lock.

## API

    const service = new WorkflowRunService({
      projectRoot: process.cwd(),
      projectId: "my-project",
    });

    const run = await service.createRun(workflow, {
      feature_description: "Add account settings",
    });

    const started = await service.startRun(run.id, workflow);

    const next = await service.transitionStage(
      run.id,
      workflow,
      "discovery",
      "in_progress",
    );

The workflow definition is supplied for each operation. This makes version matching explicit and allows a future CLI to reload an immutable version from disk. The service rejects a definition whose ID or version differs from the run's pinned identity.

## Event and snapshot consistency

Every state mutation creates an event with a monotonically increasing run-wide sequence. FileStateStore.commitEventAndSnapshot holds the run lock while checking the expected sequence, appending and fsyncing the event, and atomically replacing the run snapshot.

A filesystem/process crash between the durable event append and snapshot replacement can still leave a pending event. This is not a multi-file filesystem transaction. The service detects that condition and raises RunRecoveryRequiredError instead of continuing from stale state.

`recoverRun` replays the currently supported run-status and stage-transition events in sequence order. It checks event identity, status transitions, dependency readiness, and stage lifecycle rules before writing the recovered snapshot. Unknown events fail closed and remain in the append-only log. Once replay completes, a running workflow re-evaluates eligible pending stages so a crash after `run.started` does not leave the workflow without ready work.

`pauseRun`, `resumeRun`, and `cancelRun` persist lifecycle changes through the same event/snapshot mechanism. Resume first attempts recovery using the workflow definition pinned by ID and version.

## Dependency semantics

A stage becomes ready only when every declared dependency is in completed state. The service computes the transitive dependency closure of workflow.completion.required_stages and activates only stages in that closure. An optional stage that is a prerequisite of a required completion stage is therefore executed as part of the required path. An independent optional stage remains pending and does not block run completion.

A skipped optional dependency is not considered complete in this version because the workflow contract does not yet define an explicit skip policy or a guarantee that its outputs are unnecessary. Independent eligible root stages in the required dependency closure can become ready together. This only produces a plan/state; it does not launch agents or promise parallel execution.

## Input and secret handling

Inputs are checked against the declared primitive type, required flag, and default. Unknown keys are rejected. Persisted inputs are JSON-normalized.

Do not pass raw credentials, API keys, or other secrets as workflow inputs. The initial run store writes input values to local project files. A future secret-reference contract will keep secret material outside workflow state.

## Current limits

- Replay supports the event types currently emitted by WorkflowRunService; unknown event types require an explicit reducer before they can be recovered.
- A hard crash between event append and snapshot write is recoverable, but the two-file update is not an atomic filesystem transaction.
- A process crash while holding a lock can leave a stale lock file; automatic stale-lock reclamation is not implemented.
- No conditional stage evaluation.
- No optional dependency skip policy.
- No explicit selection mechanism for independent optional stages.
- No agent execution or delegation.
- No output/verification artifact enforcement.

These constraints are deliberate. Recovery fails closed rather than guessing how to interpret unknown events or reclaim locks.
