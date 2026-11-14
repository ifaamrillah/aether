import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  planReadyStageTasks,
  TaskResultValidationError,
  verifyTaskResult,
} from "./delegation.js";
import type { WorkflowDefinition } from "./types.js";
import type { WorkflowRunSnapshot } from "../state/types.js";

let root: string;
const workflow: WorkflowDefinition = {
  schema_version: 1,
  id: "feature",
  version: 1,
  name: "Feature",
  description: "Feature workflow",
  inputs: [],
  stages: [{
    id: "implementation",
    skill: "implementation",
    required: true,
    scope: {
      read_paths: ["src/**", "tests/**"],
      write_paths: ["src/**", "tests/**"],
    },
    acceptance_criteria: ["Tests pass"],
  }],
  completion: { required_stages: ["implementation"] },
};

const snapshot: WorkflowRunSnapshot = {
  schema_version: 1,
  id: "run_test",
  workflow_id: "feature",
  workflow_version: 1,
  status: "running",
  project_id: "test",
  inputs: {},
  stages: {
    implementation: {
      stage_id: "implementation",
      status: "ready",
      attempt: 0,
      inputs: [],
      outputs: [],
      last_event_sequence: 2,
    },
  },
  current_stage_ids: ["implementation"],
  created_at: "2026-11-15T00:00:00.000Z",
  updated_at: "2026-11-15T00:00:00.000Z",
  last_event_sequence: 2,
  snapshot_sequence: 2,
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aether-delegation-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, "src", "feature.ts"), "export const feature = true;\n");
  await writeFile(join(root, "tests", "feature.test.ts"), "test('feature', () => {});\n");
  await writeFile(join(root, "test-report.txt"), "2 tests passed\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("stage delegation contracts", () => {
  it("creates stable contracts only for ready stages", () => {
    const tasks = planReadyStageTasks(snapshot, workflow, "generic");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.task_id).toBe("task_run_test_implementation");
    expect(tasks[0]?.file_scope.write_paths).toEqual(["src/**", "tests/**"]);
    expect(tasks[0]?.expected_result_path).toContain("result.json");
  });

  it("rejects a workflow version that does not match the run", () => {
    expect(() =>
      planReadyStageTasks(snapshot, { ...workflow, version: 2 }, "generic"),
    ).toThrow(/pinned identity and version/);
  });

  it("verifies in-scope changed files and checksums evidence", async () => {
    const task = planReadyStageTasks(snapshot, workflow, "generic")[0]!;
    const result = await verifyTaskResult(task, {
      schema_version: 1,
      task_id: task.task_id,
      run_id: task.run_id,
      stage_id: task.stage_id,
      summary: "Implemented the feature and added tests.",
      changed_files: ["src/feature.ts", "tests/feature.test.ts"],
      evidence: [{
        path: ".aether/handoffs/run_test/implementation/output/test-report.txt",
        type: "test_report",
        result: "passed",
      }],
    }, root, () => new Date("2026-11-15T01:00:00.000Z"));

    expect(result.evidence[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence[0]?.size_bytes).toBeGreaterThan(0);
  });

  it("rejects changed files outside declared write paths", async () => {
    const task = planReadyStageTasks(snapshot, workflow, "generic")[0]!;
    await expect(verifyTaskResult(task, {
      schema_version: 1,
      task_id: task.task_id,
      run_id: task.run_id,
      stage_id: task.stage_id,
      summary: "Attempt out-of-scope change.",
      changed_files: ["README.md"],
      evidence: [{ path: ".aether/handoffs/run_test/implementation/output/test-report.txt", type: "test_report", result: "passed" }],
    }, root)).rejects.toBeInstanceOf(TaskResultValidationError);
  });

  it("rejects path traversal and missing evidence", async () => {
    const task = planReadyStageTasks(snapshot, workflow, "generic")[0]!;
    await expect(verifyTaskResult(task, {
      schema_version: 1,
      task_id: task.task_id,
      run_id: task.run_id,
      stage_id: task.stage_id,
      summary: "Unsafe result.",
      changed_files: ["../outside.txt"],
      evidence: [{ path: ".aether/handoffs/run_test/implementation/output/test-report.txt", type: "test_report", result: "passed" }],
    }, root)).rejects.toBeInstanceOf(TaskResultValidationError);

    await expect(verifyTaskResult(task, {
      schema_version: 1,
      task_id: task.task_id,
      run_id: task.run_id,
      stage_id: task.stage_id,
      summary: "Missing evidence.",
      changed_files: [],
      evidence: [{ path: "missing.txt", type: "test_report", result: "passed" }],
    }, root)).rejects.toBeInstanceOf(TaskResultValidationError);
  });

  it("requires at least one passing evidence record", async () => {
    const task = planReadyStageTasks(snapshot, workflow, "generic")[0]!;
    await expect(verifyTaskResult(task, {
      schema_version: 1,
      task_id: task.task_id,
      run_id: task.run_id,
      stage_id: task.stage_id,
      summary: "Documentation-only evidence.",
      changed_files: [],
      evidence: [{
        path: ".aether/handoffs/run_test/implementation/output/test-report.txt",
        type: "documentation",
        result: "informational",
      }],
    }, root)).rejects.toBeInstanceOf(TaskResultValidationError);
  });

  it("rejects failed evidence records", async () => {
    const task = planReadyStageTasks(snapshot, workflow, "generic")[0]!;
    await expect(verifyTaskResult(task, {
      schema_version: 1,
      task_id: task.task_id,
      run_id: task.run_id,
      stage_id: task.stage_id,
      summary: "Failed tests.",
      changed_files: [],
      evidence: [{ path: ".aether/handoffs/run_test/implementation/output/test-report.txt", type: "test_report", result: "failed" }],
    }, root)).rejects.toBeInstanceOf(TaskResultValidationError);
  });
});
