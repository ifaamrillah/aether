# Workflow Run Service

WorkflowRunService is the application service that creates and advances a workflow run. It coordinates workflow semantics, stage lifecycle transitions, the file-backed state store, and the append-only event log.

## Responsibilities

- Validate the workflow dependency graph before creating a run.
- Validate provided inputs, defaults, and unknown input keys.
- Pin a run to a workflow ID and version.
- Initialize all stage states as pending.
- Start a run and mark dependency-free stages as ready.
- Promote a pending stage to ready only after all its dependencies are completed.
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

A filesystem/process crash between the durable event append and snapshot replacement can still leave a pending event. This is not a multi-file filesystem transaction. The service detects that condition and raises RunRecoveryRequiredError instead of continuing from stale state. Deterministic event replay and explicit recovery are a subsequent milestone.

## Dependency semantics

A stage becomes ready only when every declared dependency is in completed state. A skipped optional dependency is not considered complete in this version because the workflow contract does not yet define an explicit skip policy or a guarantee that its outputs are unnecessary.

Independent root stages can become ready together. This only produces a plan/state; it does not launch agents or promise parallel execution.

## Input and secret handling

Inputs are checked against the declared primitive type, required flag, and default. Unknown keys are rejected. Persisted inputs are JSON-normalized.

Do not pass raw credentials, API keys, or other secrets as workflow inputs. The initial run store writes input values to local project files. A future secret-reference contract will keep secret material outside workflow state.

## Current limits

- No resume, pause, cancel, or crash event replay yet.
- No conditional stage evaluation.
- No optional dependency skip policy.
- No agent execution or delegation.
- No output/verification artifact enforcement.
- No multi-process event-snapshot recovery after a hard process crash.

These are intentionally separate milestones; the service currently provides a deterministic local run lifecycle baseline.
