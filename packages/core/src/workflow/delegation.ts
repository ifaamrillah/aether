import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkflowRunSnapshot } from "../state/types.js";
import type { WorkflowDefinition, WorkflowStageDefinition } from "./types.js";

export interface StageTaskContract {
  schema_version: 1;
  task_id: string;
  run_id: string;
  workflow_id: string;
  workflow_version: number;
  stage_id: string;
  title: string;
  objective: string;
  suggested_role: string;
  adapter_id: string;
  dependencies: string[];
  file_scope: {
    read_paths: string[];
    write_paths: string[];
  };
  output_paths: string[];
  acceptance_criteria: string[];
  expected_result_path: string;
  created_at: string;
}

export type TaskEvidenceType =
  | "test_report"
  | "build_log"
  | "screenshot"
  | "trace"
  | "review_record"
  | "security_scan"
  | "design_artifact"
  | "documentation"
  | "other";

export interface TaskResultSubmission {
  schema_version: 1;
  task_id: string;
  run_id: string;
  stage_id: string;
  summary: string;
  changed_files: string[];
  evidence: Array<{
    path: string;
    type: TaskEvidenceType;
    result: "passed" | "informational" | "failed";
    summary?: string;
  }>;
}

export interface VerifiedTaskEvidence {
  path: string;
  type: TaskEvidenceType;
  result: "passed" | "informational";
  summary?: string;
  sha256: string;
  size_bytes: number;
}

export interface VerifiedChangedFile {
  path: string;
  sha256: string;
  size_bytes: number;
}

export interface VerifiedTaskResult {
  schema_version: 1;
  task_id: string;
  run_id: string;
  stage_id: string;
  summary: string;
  changed_files: VerifiedChangedFile[];
  evidence: VerifiedTaskEvidence[];
  verified_at: string;
}

export class TaskResultValidationError extends Error {
  constructor(readonly issues: string[]) {
    super("Task result validation failed:\n- " + issues.join("\n- "));
    this.name = "TaskResultValidationError";
  }
}

const DEFAULT_ACCEPTANCE_CRITERIA = [
  "Provide a concise summary of the work performed.",
  "List every changed project file within the declared write scope.",
  "Attach at least one existing evidence file that supports the result.",
];

function inferredRole(stage: WorkflowStageDefinition): string {
  const key = (stage.skill + " " + stage.id).toLowerCase();
  if (/(discover|research|analys|product)/.test(key)) return "Analyst";
  if (/(design|prototype|wireframe|ui|ux)/.test(key)) return "Product Designer";
  if (/(test|quality|qa|verification)/.test(key)) return "QA Engineer";
  if (/(security|threat|audit)/.test(key)) return "Security Auditor";
  if (/(document|knowledge|writing)/.test(key)) return "Technical Writer";
  if (/(architecture|architect)/.test(key)) return "Software Architect";
  if (/(plan)/.test(key)) return "Engineering Planner";
  return "Software Engineer";
}

function taskId(runId: string, stageId: string): string {
  return "task_" + runId + "_" + stageId;
}

export function planReadyStageTasks(
  snapshot: WorkflowRunSnapshot,
  workflow: WorkflowDefinition,
  adapterId: string,
): StageTaskContract[] {
  if (
    snapshot.workflow_id !== workflow.id ||
    snapshot.workflow_version !== workflow.version
  ) {
    throw new Error("Workflow definition does not match the run's pinned identity and version.");
  }

  const stages = new Map(workflow.stages.map((stage) => [stage.id, stage] as const));
  const ready = workflow.stages.filter(
    (stage) => snapshot.stages[stage.id]?.status === "ready",
  );

  return ready.map((stage) => {
    const writePaths = [...(stage.scope?.write_paths ?? [])];
    const readPaths = [...(stage.scope?.read_paths ?? [])];
    return {
      schema_version: 1,
      task_id: taskId(snapshot.id, stage.id),
      run_id: snapshot.id,
      workflow_id: workflow.id,
      workflow_version: workflow.version,
      stage_id: stage.id,
      title: stage.name ?? stage.id.replace(/[-_]/g, " "),
      objective: stage.description ?? "Complete the " + stage.skill + " stage.",
      suggested_role: inferredRole(stage),
      adapter_id: adapterId,
      dependencies: (stage.depends_on ?? []).map((id) => taskId(snapshot.id, id)),
      file_scope: {
        read_paths: readPaths,
        write_paths: writePaths,
      },
      output_paths: [".aether/handoffs/" + snapshot.id + "/" + stage.id + "/output/**"],
      acceptance_criteria: stage.acceptance_criteria?.length
        ? [...stage.acceptance_criteria]
        : [...DEFAULT_ACCEPTANCE_CRITERIA],
      expected_result_path: ".aether/handoffs/" + snapshot.id + "/" + stage.id + "/result.json",
      created_at: snapshot.updated_at,
    };
  });
}

function validateRelativePath(path: string, label: string): string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\\") ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path)
  ) {
    throw new TaskResultValidationError([label + " must be a non-empty relative POSIX path."]);
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new TaskResultValidationError([label + " contains an unsafe path segment."]);
  }
  return path;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

function matchesWriteScope(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === "**/*" || pattern === "**") return true;
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      return path === prefix || path.startsWith(prefix + "/");
    }
    return path === pattern;
  });
}

async function resolveSafeRegularFile(
  root: string,
  path: string,
  label: string,
): Promise<{ realPath: string; sizeBytes: number }> {
  const segments = path.split("/");
  let current = root;

  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    const details = await lstat(current).catch(() => {
      throw new TaskResultValidationError([label + " does not exist: " + path]);
    });
    if (details.isSymbolicLink()) {
      throw new TaskResultValidationError([
        label + " must not traverse symbolic links: " + path,
      ]);
    }
    const isLast = index === segments.length - 1;
    if (!isLast && !details.isDirectory()) {
      throw new TaskResultValidationError([
        label + " contains a non-directory path component: " + path,
      ]);
    }
    if (isLast && !details.isFile()) {
      throw new TaskResultValidationError([
        label + " must be a regular file: " + path,
      ]);
    }
  }

  const realPath = await realpath(current).catch(() => {
    throw new TaskResultValidationError([label + " does not resolve: " + path]);
  });
  if (!isWithinRoot(root, realPath)) {
    throw new TaskResultValidationError([
      label + " resolves outside the project root: " + path,
    ]);
  }
  const details = await lstat(realPath);
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new TaskResultValidationError([
      label + " is not a regular file: " + path,
    ]);
  }
  return { realPath, sizeBytes: details.size };
}

/**
 * Validates a submitted task result against the handoff contract and the real
 * project filesystem. Evidence is checksummed only after symlink-safe path
 * containment and regular-file checks.
 */
export async function verifyTaskResult(
  task: StageTaskContract,
  submission: TaskResultSubmission,
  projectRoot: string,
  clock: () => Date = () => new Date(),
): Promise<VerifiedTaskResult> {
  const issues: string[] = [];
  if (submission.schema_version !== 1) issues.push("Unsupported task result schema version.");
  if (submission.task_id !== task.task_id) issues.push("Task ID does not match the handoff contract.");
  if (submission.run_id !== task.run_id) issues.push("Run ID does not match the handoff contract.");
  if (submission.stage_id !== task.stage_id) issues.push("Stage ID does not match the handoff contract.");
  if (typeof submission.summary !== "string" || submission.summary.trim().length === 0) {
    issues.push("A non-empty result summary is required.");
  }
  if (!Array.isArray(submission.changed_files)) issues.push("changed_files must be an array.");
  if (!Array.isArray(submission.evidence) || submission.evidence.length === 0) {
    issues.push("At least one evidence file is required.");
  }
  if (issues.length > 0) throw new TaskResultValidationError(issues);

  const root = await realpath(resolve(projectRoot));
  const seenChanged = new Set<string>();
  const verifiedChanged: VerifiedChangedFile[] = [];

  for (const rawPath of submission.changed_files) {
    const path = validateRelativePath(rawPath, "Changed file path");
    if (seenChanged.has(path)) {
      throw new TaskResultValidationError(["Duplicate changed file path: " + path]);
    }
    seenChanged.add(path);
    if (!matchesWriteScope(path, task.file_scope.write_paths)) {
      throw new TaskResultValidationError([
        'Changed file "' + path + '" is outside the task write scope.',
      ]);
    }
    const resolved = await resolveSafeRegularFile(root, path, "Changed file");
    const bytes = await readFile(resolved.realPath);
    verifiedChanged.push({
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size_bytes: bytes.length,
    });
  }

  const validTypes: TaskEvidenceType[] = [
    "test_report", "build_log", "screenshot", "trace", "review_record",
    "security_scan", "design_artifact", "documentation", "other",
  ];
  const verifiedEvidence: VerifiedTaskEvidence[] = [];

  for (const item of submission.evidence) {
    const path = validateRelativePath(item.path, "Evidence path");
    if (!matchesWriteScope(path, task.output_paths)) {
      throw new TaskResultValidationError([
        'Evidence file "' + path + '" is outside the task output paths.',
      ]);
    }
    if (!validTypes.includes(item.type)) {
      throw new TaskResultValidationError(["Unsupported evidence type for " + path]);
    }
    if (
      item.result !== "passed" &&
      item.result !== "informational" &&
      item.result !== "failed"
    ) {
      throw new TaskResultValidationError(["Unsupported evidence result for " + path]);
    }
    if (item.result === "failed") {
      throw new TaskResultValidationError(["Evidence reports failure: " + path]);
    }
    const resolved = await resolveSafeRegularFile(root, path, "Evidence file");
    if (resolved.sizeBytes === 0) {
      throw new TaskResultValidationError(["Evidence must be a non-empty regular file: " + path]);
    }
    const bytes = await readFile(resolved.realPath);
    const evidence: VerifiedTaskEvidence = {
      path,
      type: item.type,
      result: item.result,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size_bytes: bytes.length,
    };
    if (item.summary !== undefined) evidence.summary = item.summary;
    verifiedEvidence.push(evidence);
  }

  if (!verifiedEvidence.some((item) => item.result === "passed")) {
    throw new TaskResultValidationError([
      "At least one evidence record must report a passed result.",
    ]);
  }

  const timestamp = clock();
  if (!Number.isFinite(timestamp.getTime())) {
    throw new TaskResultValidationError(["Verification clock returned an invalid timestamp."]);
  }

  return {
    schema_version: 1,
    task_id: task.task_id,
    run_id: task.run_id,
    stage_id: task.stage_id,
    summary: submission.summary.trim(),
    changed_files: verifiedChanged,
    evidence: verifiedEvidence,
    verified_at: timestamp.toISOString(),
  };
}
