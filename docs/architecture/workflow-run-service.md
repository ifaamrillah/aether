# Workflow Run Service

WorkflowRunService creates and advances workflow runs. It coordinates workflow semantics, stage lifecycle transitions, the file-backed state store, event history, and evidence-backed completion.

## Responsibilities

- Validate the workflow dependency graph before creating a run.
- Validate provided inputs, defaults, and unknown input keys.
- Pin a run to a workflow ID and version.
- Initialize all stage states as pending.
- Start a run and mark required-path stages as ready when dependencies complete.
- Apply stage changes through the canonical stage transition state machine.
- Update run status from required completion stages and blocking states.
- Persist each event and its corresponding snapshot under one per-run store lock.
- Require a persisted, checksummed verification manifest before a stage can complete.

## API

```ts
const service = new WorkflowRunService({
  projectRoot: process.cwd(),
  projectId: "my-project",
});

const run = await service.createRun(workflow, {
  feature_description: "Add account settings",
});

const started = await service.startRun(run.id, workflow);
```

The workflow definition is supplied for each operation. The service rejects a definition whose ID or version differs from the run's pinned identity.

## Evidence-backed completion

A transition to `completed` requires a `StageVerificationReference` that points to a manifest inside the project and contains a SHA-256 digest. The service re-reads the manifest and evidence files, verifies exact run/stage/task identity, checks file-scope constraints, confirms evidence remains within the task output directory, and recomputes every checksum.

The manifest and evidence file checks prevent a caller from completing a stage by passing a hand-constructed `{ status: "passed" }` object. Hashes establish integrity of the referenced files, not the truth of their contents or proof that a command was executed.

## Event and snapshot consistency

Every state mutation creates an event with a monotonic run-wide sequence. `FileStateStore.commitEventAndSnapshot` holds the run lock while checking the expected sequence, appending and fsyncing the event, and atomically replacing the run snapshot.

A crash between the durable event append and snapshot replacement can leave a pending event. `recoverRun` replays supported events in sequence order. Unknown event types or invalid verification references fail closed and remain in the log.

## Dependency semantics

The service computes the transitive dependency closure of `completion.required_stages` and activates stages in that closure. An optional stage that is a prerequisite of a required completion stage is therefore executed as part of the required path. Independent optional stages remain pending and do not prevent completion.

## Current limits

- Recovery supports the run and stage event types currently emitted by this service.
- A hard crash may leave a stale lock; automatic stale-lock reclamation is not implemented.
- Conditional stage conditions are evaluated after dependencies complete; false conditions produce a `skipped` stage. General optional dependency skip policies beyond explicit stage conditions are not implemented.
- Native agent invocation and parallel dispatch are not implemented by the current adapters.
- Evidence hashes do not establish the semantic truth of agent-submitted reports.
- No production deployment, rollback, or external approval engine is included in this milestone.
