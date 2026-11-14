import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileStateStore,
  RunRecoveryRequiredError,
  WorkflowInputValidationError,
  WorkflowRunConflictError,
  WorkflowRunService,
} from "../index.js";
import type { WorkflowDefinition } from "./types.js";

let projectRoot: string;
let service: WorkflowRunService;
let currentTime: number;
let idCounter: number;

const workflow: WorkflowDefinition = {
  schema_version: 1,
  id: "feature-development",
  version: 1,
  name: "Feature Development",
  description: "A two-stage test workflow.",
  inputs: [
    { name: "feature_description", type: "string", required: true },
    { name: "include_docs", type: "boolean", required: false, default: true },
  ],
  stages: [
    { id: "discovery", skill: "discovery", required: true },
    {
      id: "implementation",
      skill: "implementation",
      required: true,
      depends_on: ["discovery"],
    },
    { id: "documentation", skill: "documentation", required: false },
  ],
  completion: {
    required_stages: ["discovery", "implementation"],
  },
};

async function createVerification(runId: string, stageId: string) {
  const outputPath =
    ".aether/handoffs/" + runId + "/" + stageId + "/output/test-report.txt";
  const manifestPath =
    ".aether/verification/" + runId + "/" + stageId + ".json";
  const evidenceBytes = Buffer.from("Test evidence for " + stageId + "\n", "utf8");
  const evidenceHash = createHash("sha256").update(evidenceBytes).digest("hex");
  const result = {
    schema_version: 1,
    task_id: "task_" + runId + "_" + stageId,
    run_id: runId,
    stage_id: stageId,
    summary: "Verified test evidence for " + stageId,
    changed_files: [],
    evidence: [{
      path: outputPath,
      type: "test_report",
      result: "passed",
      summary: "Fixture evidence",
      sha256: evidenceHash,
      size_bytes: evidenceBytes.length,
    }],
    verified_at: "2026-11-15T01:00:00.000Z",
  };
  const manifestContent = JSON.stringify(result, null, 2) + "\n";
  await mkdir(join(projectRoot, ".aether", "handoffs", runId, stageId, "output"), { recursive: true });
  await mkdir(join(projectRoot, ".aether", "verification", runId), { recursive: true });
  await writeFile(join(projectRoot, outputPath), evidenceBytes);
  await writeFile(join(projectRoot, manifestPath), manifestContent, "utf8");

  return {
    artifact_id: "verification-" + runId + "-" + stageId,
    path: manifestPath,
    status: "passed" as const,
    evidence_count: result.evidence.length,
    verified_at: result.verified_at,
    sha256: createHash("sha256").update(manifestContent, "utf8").digest("hex"),
  };
}
function createService(): WorkflowRunService {
  return new WorkflowRunService({
    projectRoot,
    projectId: "test-project",
    clock: () => new Date(currentTime),
    idFactory: () => "test-id-" + (++idCounter),
  });
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "aether-run-service-"));
  currentTime = Date.parse("2026-11-15T01:00:00.000Z");
  idCounter = 0;
  service = createService();
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("WorkflowRunService", () => {
  it("creates a version-pinned run with validated inputs and pending stages", async () => {
    const run = await service.createRun(workflow, {
      feature_description: "Add account settings",
    });

    expect(run.id).toBe("run_test-id-1");
    expect(run.workflow_id).toBe(workflow.id);
    expect(run.workflow_version).toBe(workflow.version);
    expect(run.status).toBe("created");
    expect(run.inputs).toEqual({
      feature_description: "Add account settings",
      include_docs: true,
    });
    expect(Object.values(run.stages).every((stage) => stage.status === "pending")).toBe(true);

    const events = await new FileStateStore(projectRoot).readEvents(run.id);
    expect(events.map((event) => event.type)).toEqual(["run.created"]);
  });

  it("rejects missing, incorrectly typed, and unknown inputs", async () => {
    await expect(service.createRun(workflow, {})).rejects.toBeInstanceOf(
      WorkflowInputValidationError,
    );
    await expect(
      service.createRun(workflow, { feature_description: 42 }),
    ).rejects.toBeInstanceOf(WorkflowInputValidationError);
    await expect(
      service.createRun(workflow, {
        feature_description: "Valid",
        unexpected: true,
      }),
    ).rejects.toBeInstanceOf(WorkflowInputValidationError);
  });

  it("starts root stages and releases a dependent only after completion", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Add settings",
    });
    const started = await service.startRun(created.id, workflow);

    expect(started.status).toBe("running");
    expect(started.stages.discovery?.status).toBe("ready");
    expect(started.stages.implementation?.status).toBe("pending");

    const inProgress = await service.transitionStage(
      created.id,
      workflow,
      "discovery",
      "in_progress",
    );
    expect(inProgress.stages.discovery?.attempt).toBe(1);

    const verifying = await service.transitionStage(
      created.id,
      workflow,
      "discovery",
      "verifying",
    );
    expect(verifying.stages.discovery?.status).toBe("verifying");

    const completed = await service.transitionStage(
      created.id,
      workflow,
      "discovery",
      "completed",
      { verification: await createVerification(created.id, "discovery") },
    );
    expect(completed.stages.discovery?.status).toBe("completed");
    expect(completed.stages.implementation?.status).toBe("ready");
    expect(completed.status).toBe("running");
  });

  it("does not complete a stage without a passed verification manifest", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Require evidence",
    });
    await service.startRun(created.id, workflow);
    await service.transitionStage(created.id, workflow, "discovery", "in_progress");
    await service.transitionStage(created.id, workflow, "discovery", "verifying");

    await expect(
      service.transitionStage(created.id, workflow, "discovery", "completed"),
    ).rejects.toBeInstanceOf(WorkflowRunConflictError);
  });

  it("rejects a verification manifest whose evidence checksum has gone stale", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Detect tampered evidence",
    });
    await service.startRun(created.id, workflow);
    await service.transitionStage(created.id, workflow, "discovery", "in_progress");
    await service.transitionStage(created.id, workflow, "discovery", "verifying");
    const verification = await createVerification(created.id, "discovery");
    const evidencePath = join(
      projectRoot,
      ".aether",
      "handoffs",
      created.id,
      "discovery",
      "output",
      "test-report.txt",
    );
    await writeFile(evidencePath, "Tampered after verification.", "utf8");

    await expect(
      service.transitionStage(
        created.id,
        workflow,
        "discovery",
        "completed",
        { verification },
      ),
    ).rejects.toBeInstanceOf(WorkflowRunConflictError);
  });

  it("does not allow starting a dependent stage before its dependencies complete", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Add settings",
    });
    await service.startRun(created.id, workflow);

    await expect(
      service.transitionStage(created.id, workflow, "implementation", "ready"),
    ).rejects.toBeInstanceOf(WorkflowRunConflictError);
  });

  it("rejects workflow version drift on a run", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Add settings",
    });
    const changed = { ...workflow, version: 2 };

    await expect(service.startRun(created.id, changed)).rejects.toBeInstanceOf(
      WorkflowRunConflictError,
    );
  });

  it("marks the run completed when all required completion stages complete", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Add settings",
    });
    await service.startRun(created.id, workflow);
    await service.transitionStage(created.id, workflow, "discovery", "in_progress");
    await service.transitionStage(created.id, workflow, "discovery", "verifying");
    await service.transitionStage(
      created.id, workflow, "discovery", "completed",
      { verification: await createVerification(created.id, "discovery") },
    );
    await service.transitionStage(created.id, workflow, "implementation", "in_progress");
    await service.transitionStage(created.id, workflow, "implementation", "verifying");

    const completed = await service.transitionStage(
      created.id,
      workflow,
      "implementation",
      "completed",
      { verification: await createVerification(created.id, "implementation") },
    );

    expect(completed.status).toBe("completed");
    expect(completed.stages.implementation?.status).toBe("completed");
    expect(completed.current_stage_ids).toEqual([]);
  });

  it("rejects a required stage from being skipped", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Add settings",
    });
    await service.startRun(created.id, workflow);

    await expect(
      service.transitionStage(created.id, workflow, "discovery", "skipped"),
    ).rejects.toBeInstanceOf(WorkflowRunConflictError);
  });

  it("detects a log event not incorporated into the snapshot", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Add settings",
    });
    const store = new FileStateStore(projectRoot);
    await store.appendEvent(created.id, {
      schema_version: 1,
      event_id: "event_external",
      run_id: created.id,
      sequence: 2,
      type: "run.paused",
      timestamp: "2026-11-15T01:00:00.000Z",
      actor: { type: "system", id: "test" },
      entity: { type: "run", id: created.id },
      payload: {},
    });

    await expect(service.getRun(created.id)).rejects.toBeInstanceOf(
      RunRecoveryRequiredError,
    );
  });

  it("leaves independent optional stages dormant outside required completion paths", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Add settings",
    });
    const started = await service.startRun(created.id, workflow);

    expect(started.stages.discovery?.status).toBe("ready");
    expect(started.stages.documentation?.status).toBe("pending");
  });

  it("executes optional stages that are dependencies of required completion stages", async () => {
    const workflowWithOptionalDependency: WorkflowDefinition = {
      ...workflow,
      stages: [
        {
          id: "optional-setup",
          skill: "optional-setup",
          required: false,
        },
        {
          ...workflow.stages[0]!,
          depends_on: ["optional-setup"],
        },
        ...workflow.stages.slice(1),
      ],
    };
    const created = await service.createRun(workflowWithOptionalDependency, {
      feature_description: "Add settings",
    });
    const started = await service.startRun(created.id, workflowWithOptionalDependency);

    expect(started.stages["optional-setup"]?.status).toBe("ready");
    expect(started.stages.discovery?.status).toBe("pending");

    const completed = await service.transitionStage(
      created.id,
      workflowWithOptionalDependency,
      "optional-setup",
      "in_progress",
    );
    const verifying = await service.transitionStage(
      created.id,
      workflowWithOptionalDependency,
      "optional-setup",
      "verifying",
    );
    expect(verifying.stages["optional-setup"]?.status).toBe("verifying");

    const done = await service.transitionStage(
      created.id,
      workflowWithOptionalDependency,
      "optional-setup",
      "completed",
      { verification: await createVerification(created.id, "optional-setup") },
    );
    expect(done.stages.discovery?.status).toBe("ready");
    expect(done.status).toBe("running");
    expect(completed.stages["optional-setup"]?.attempt).toBe(1);
  });
  it("pauses and resumes a run while preserving ready stage state", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Add settings",
    });
    await service.startRun(created.id, workflow);

    const paused = await service.pauseRun(created.id);
    expect(paused.status).toBe("paused");
    expect(paused.stages.discovery?.status).toBe("ready");

    await expect(
      service.transitionStage(created.id, workflow, "discovery", "in_progress"),
    ).rejects.toBeInstanceOf(WorkflowRunConflictError);

    const resumed = await service.resumeRun(created.id, workflow);
    expect(resumed.status).toBe("running");
    expect(resumed.stages.discovery?.status).toBe("ready");
  });

  it("recovers an event appended before the snapshot was updated", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Recover an interrupted start",
    });
    const store = new FileStateStore(projectRoot);
    await store.appendEvent(created.id, {
      schema_version: 1,
      event_id: "event_interrupted_start",
      run_id: created.id,
      sequence: 2,
      type: "run.started",
      timestamp: "2026-11-15T01:00:01.000Z",
      actor: { type: "system", id: "aether" },
      entity: { type: "run", id: created.id },
      payload: { from: "created", to: "running" },
    });

    const recovered = await service.recoverRun(created.id, workflow);
    expect(recovered.status).toBe("running");
    expect(recovered.stages.discovery?.status).toBe("ready");
    expect(recovered.last_event_sequence).toBe(3);

    const events = await store.readEvents(created.id);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);

    const recoveredAgain = await service.recoverRun(created.id, workflow);
    expect(recoveredAgain.last_event_sequence).toBe(3);
    expect((await store.readEvents(created.id)).map((event) => event.sequence))
      .toEqual([1, 2, 3]);
  });

  it("cancels a run and rejects later resume attempts", async () => {
    const created = await service.createRun(workflow, {
      feature_description: "Cancel a run",
    });
    await service.startRun(created.id, workflow);
    const cancelled = await service.cancelRun(created.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.current_stage_ids).toEqual([]);

    await expect(
      service.resumeRun(created.id, workflow),
    ).rejects.toBeInstanceOf(WorkflowRunConflictError);
  });

});
