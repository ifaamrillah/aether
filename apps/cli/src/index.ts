#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import {
  FileStateStore,
  WorkflowRunService,
  getAetherVersion,
  planReadyStageTasks,
  verifyTaskResult,
} from "@aether/core";
import type { TaskResultSubmission } from "@aether/core";
import { createAgentAdapter } from "@aether/adapters";
import {
  validateAgentAdapterDescriptor,
  validateDelegationContract,
  validateTaskResultSubmission,
} from "@aether/schemas";
import type { AdapterId } from "@aether/adapters";
import {
  parseWorkflowDefinition,
  validateWorkflowContent,
} from "./commands/workflow-validate.js";
import { parseWorkflowRunOptions } from "./commands/workflow-inputs.js";

function printHelp(): void {
  console.log(`Aether — AI Engineering Harness

Usage:
  aether <command>

Commands:
  version                                      Show CLI and core version
  workflow validate <file>                    Validate workflow YAML and show execution waves
  workflow run <file> [--input name=value]     Create and start a workflow run
  workflow status <run-id>                    Show persisted run and pending recovery events
  workflow handoff <run-id> --file <file>      Generate agent handoffs for ready stages
  workflow accept <run-id> --file <file> --stage <id> --result <json>
                                               Verify task result and complete its stage
  workflow pause <run-id>                     Pause a running workflow
  workflow resume <run-id> --file <file>       Recover if needed, then resume a paused workflow
  workflow recover <run-id> --file <file>      Replay pending events and reconcile run state
  workflow cancel <run-id>                    Cancel a non-terminal workflow run
  help                                         Show this help

Handoff options:
  --adapter generic|claude-code|codex|opencode|gemini-cli|antigravity

Input values use YAML scalar syntax:
  --input feature_description="Add account settings"
  --input include_docs=true
  --input retry_limit=3
`);
}

function createRunService(projectId?: string): WorkflowRunService {
  return new WorkflowRunService({
    projectRoot: process.cwd(),
    projectId: projectId ?? basename(resolve(process.cwd())),
  });
}

function loadWorkflowFile(path: string) {
  return readFile(path, "utf8").then((content) => {
    const result = parseWorkflowDefinition(content);
    if (!result.ok) {
      throw new Error(
        "Workflow validation failed:\n- " + result.errors.join("\n- "),
      );
    }
    return result.definition;
  });
}

function parseOptions(args: string[], allowed: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!allowed.includes(flag)) {
      throw new Error('Unknown option "' + flag + '". Allowed options: ' + allowed.join(", "));
    }
    if (Object.prototype.hasOwnProperty.call(parsed, flag)) {
      throw new Error(flag + " can only be provided once.");
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("Missing value after " + flag + ".");
    }
    parsed[flag] = value;
    index += 1;
  }
  return parsed;
}

function parseAdapterId(value: string | undefined): AdapterId {
  const adapter = value ?? "generic";
  if (
    adapter !== "generic" &&
    adapter !== "claude-code" &&
    adapter !== "codex" &&
    adapter !== "opencode" &&
    adapter !== "gemini-cli" &&
    adapter !== "antigravity"
  ) {
    throw new Error('Unsupported adapter "' + adapter + '".');
  }
  return adapter;
}

function isInside(root: string, candidate: string): boolean {
  const relative = requireRelative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + sep) && relative !== "..");
}

function requireRelative(root: string, candidate: string): string {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  if (candidatePath === rootPath) return "";
  if (!candidatePath.startsWith(rootPath + sep)) return "..";
  return candidatePath.slice(rootPath.length + 1);
}

async function writeProjectFile(relativePath: string, content: string): Promise<void> {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    relativePath.split("/").some((part) => part === ".." || part === "." || part === "")
  ) {
    throw new Error("Refusing to write an unsafe project-relative path: " + relativePath);
  }

  const root = await realpath(process.cwd());
  const destination = resolve(root, ...relativePath.split("/"));
  if (!isInside(root, destination)) {
    throw new Error("Destination escaped the project root.");
  }

  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  if (!isInside(root, realParent)) {
    throw new Error("Destination parent resolves outside the project root.");
  }

  const temporary = resolve(realParent, "." + basename(destination) + "." + randomUUID() + ".tmp");
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await rename(temporary, destination);
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    await rm(temporary, { force: true });
    throw error;
  }
}

function printRun(snapshot: {
  id: string;
  workflow_id: string;
  workflow_version: number;
  status: string;
  stages: Record<string, {
    stage_id: string;
    status: string;
    attempt: number;
    verification?: { evidence_count: number };
  }>;
}): void {
  console.log("Run: " + snapshot.id);
  console.log("Workflow: " + snapshot.workflow_id + "@" + snapshot.workflow_version);
  console.log("Status: " + snapshot.status);
  console.log("Stages:");
  for (const stage of Object.values(snapshot.stages)) {
    const evidence = stage.verification
      ? " | evidence " + stage.verification.evidence_count
      : "";
    console.log(
      "  " + stage.stage_id.padEnd(24) + stage.status.padEnd(22) +
      "attempt " + stage.attempt + evidence,
    );
  }
}

async function handoffWorkflow(
  runId: string,
  args: string[],
): Promise<number> {
  const options = parseOptions(args, ["--file", "--adapter"]);
  const filePath = options["--file"];
  if (!filePath) throw new Error("Missing --file <workflow-file>.");

  const workflow = await loadWorkflowFile(filePath);
  const adapterId = parseAdapterId(options["--adapter"]);
  const adapter = createAgentAdapter(adapterId);
  const adapterValidation = validateAgentAdapterDescriptor(adapter.descriptor);
  if (!adapterValidation.valid) {
    throw new Error(
      "Adapter descriptor is invalid:\n- " +
        adapterValidation.errors.map((issue) => issue.path + ": " + issue.message).join("\n- "),
    );
  }
  const service = createRunService();
  const snapshot = await service.getRun(runId);

  const tasks = planReadyStageTasks(snapshot, workflow, adapterId);
  if (tasks.length === 0) {
    console.log("No ready stages are available for handoff.");
    printRun(snapshot);
    return 0;
  }

  const detected = await adapter.detect(process.cwd());
  console.log("Adapter: " + adapter.descriptor.name +
    (detected ? " (project marker detected)" : " (project marker not detected; handoff only)"));

  for (const task of tasks) {
    const taskValidation = validateDelegationContract(task);
    if (!taskValidation.valid) {
      throw new Error(
        "Delegation contract is invalid:\n- " +
          taskValidation.errors.map((issue) => issue.path + ": " + issue.message).join("\n- "),
      );
    }
    const base = ".aether/handoffs/" + runId + "/" + task.stage_id;
    await writeProjectFile(base + "/task.json", JSON.stringify(task, null, 2) + "\n");
    await writeProjectFile(base + "/HANDOFF.md", adapter.renderHandoff(task));
    console.log("Prepared: " + base + "/HANDOFF.md");
  }

  console.log("");
  console.log("Prepared " + tasks.length + " task handoff(s). No agent was launched.");
  return 0;
}

async function acceptWorkflowTask(
  runId: string,
  args: string[],
): Promise<number> {
  const options = parseOptions(args, ["--file", "--stage", "--result"]);
  const filePath = options["--file"];
  const stageId = options["--stage"];
  const resultPath = options["--result"];
  if (!filePath || !stageId || !resultPath) {
    throw new Error("Usage: workflow accept <run-id> --file <workflow-file> --stage <stage-id> --result <result.json>");
  }

  const workflow = await loadWorkflowFile(filePath);
  const service = createRunService();
  const snapshot = await service.getRun(runId);
  if (snapshot.workflow_id !== workflow.id || snapshot.workflow_version !== workflow.version) {
    throw new Error("Workflow definition does not match the run's pinned identity and version.");
  }

  const stageState = snapshot.stages[stageId];
  if (!stageState) throw new Error('Unknown stage "' + stageId + '".');
  if (!["ready", "in_progress", "verifying"].includes(stageState.status)) {
    throw new Error('Stage "' + stageId + '" cannot accept a result from status "' + stageState.status + '".');
  }

  const taskSnapshot = {
    ...snapshot,
    stages: {
      ...snapshot.stages,
      [stageId]: { ...stageState, status: "ready" as const },
    },
  };
  const task = planReadyStageTasks(taskSnapshot, workflow, "generic")
    .find((candidate) => candidate.stage_id === stageId);
  if (!task) throw new Error('Could not construct a delegation contract for stage "' + stageId + '".');

  const parsedResult = JSON.parse(await readFile(resultPath, "utf8")) as unknown;
  const resultValidation = validateTaskResultSubmission(parsedResult);
  if (!resultValidation.valid) {
    throw new Error(
      "Task result schema validation failed:\n- " +
        resultValidation.errors.map((issue) => issue.path + ": " + issue.message).join("\n- "),
    );
  }
  const rawResult = parsedResult as TaskResultSubmission;
  const verified = await verifyTaskResult(task, rawResult, process.cwd());
  const manifestPath = ".aether/verification/" + runId + "/" + stageId + ".json";
  const manifestContent = JSON.stringify(verified, null, 2) + "\n";
  await writeProjectFile(manifestPath, manifestContent);

  const verification = {
    artifact_id: "verification-" + runId + "-" + stageId,
    path: manifestPath,
    status: "passed" as const,
    evidence_count: verified.evidence.length,
    verified_at: verified.verified_at,
    sha256: createHash("sha256").update(manifestContent, "utf8").digest("hex"),
  };

  let current = await service.getRun(runId);
  let status = current.stages[stageId]!.status;
  if (status === "ready") {
    current = await service.transitionStage(runId, workflow, stageId, "in_progress");
    status = current.stages[stageId]!.status;
  }
  if (status === "in_progress") {
    current = await service.transitionStage(runId, workflow, stageId, "verifying");
    status = current.stages[stageId]!.status;
  }
  if (status !== "verifying") {
    throw new Error('Stage "' + stageId + '" did not reach verifying state.');
  }

  const completed = await service.transitionStage(
    runId,
    workflow,
    stageId,
    "completed",
    { verification },
  );

  console.log("Accepted result for task: " + task.task_id);
  console.log("Verified evidence: " + verified.evidence.length);
  console.log("Verification manifest: " + manifestPath);
  printRun(completed);
  return 0;
}

async function runWorkflowCommand(args: string[]): Promise<number> {
  const [subcommand, resource, ...options] = args;

  if (subcommand === "validate") {
    if (!resource) {
      console.error("Missing workflow file path.");
      return 2;
    }
    const content = await readFile(resource, "utf8");
    const result = validateWorkflowContent(content);

    if (!result.ok) {
      console.error("Workflow validation failed:");
      for (const error of result.errors) console.error("- " + error);
      return 1;
    }

    console.log("Workflow valid: " + result.workflowId + " (v" + result.version + ")");
    console.log("Execution waves:");
    result.waves.forEach((wave, index) => {
      console.log("  " + (index + 1) + ". " + wave.join(", "));
    });
    return 0;
  }

  if (subcommand === "run") {
    if (!resource) {
      console.error("Usage: aether workflow run <file> [--input name=value]");
      return 2;
    }

    const runOptions = parseWorkflowRunOptions(options);
    const workflow = await loadWorkflowFile(resource);
    const service = createRunService(runOptions.projectId);
    const created = await service.createRun(workflow, runOptions.inputs);
    const started = await service.startRun(created.id, workflow);

    printRun(started);
    console.log("");
    console.log("Run state: .aether/runs/" + started.id);
    console.log("Next: aether workflow handoff " + started.id + " --file " + resource);
    return 0;
  }

  if (subcommand === "status") {
    if (!resource) throw new Error("Usage: aether workflow status <run-id>");
    if (options.length > 0) throw new Error("workflow status does not accept additional options.");

    const loaded = await new FileStateStore(process.cwd()).loadRun(resource);
    printRun(loaded.snapshot);
    if (loaded.pendingEvents.length > 0) {
      console.log("");
      console.log(
        "Recovery required: " + loaded.pendingEvents.length +
        " event(s) are not reflected in the snapshot.",
      );
      console.log("Run: aether workflow recover " + resource + " --file <workflow-file>");
    }
    return 0;
  }

  if (subcommand === "handoff") {
    if (!resource) throw new Error("Usage: aether workflow handoff <run-id> --file <workflow-file>");
    return handoffWorkflow(resource, options);
  }

  if (subcommand === "accept") {
    if (!resource) throw new Error("Usage: aether workflow accept <run-id> --file <workflow-file> --stage <id> --result <result.json>");
    return acceptWorkflowTask(resource, options);
  }

  if (subcommand === "pause") {
    if (!resource) throw new Error("Usage: aether workflow pause <run-id>");
    if (options.length > 0) throw new Error("workflow pause does not accept additional options.");
    const snapshot = await createRunService().pauseRun(resource);
    printRun(snapshot);
    return 0;
  }

  if (subcommand === "resume" || subcommand === "recover") {
    if (!resource) {
      throw new Error("Usage: aether workflow " + subcommand + " <run-id> --file <workflow-file>");
    }
    const filePath = parseOptions(options, ["--file"])["--file"];
    if (!filePath) throw new Error("Missing --file <workflow-file>.");
    const workflow = await loadWorkflowFile(filePath);
    const service = createRunService();

    if (subcommand === "recover") {
      const snapshot = await service.recoverRun(resource, workflow);
      printRun(snapshot);
      console.log("Recovery complete. The run has not been resumed automatically.");
      return 0;
    }

    const snapshot = await service.resumeRun(resource, workflow);
    printRun(snapshot);
    return 0;
  }

  if (subcommand === "cancel") {
    if (!resource) throw new Error("Usage: aether workflow cancel <run-id>");
    if (options.length > 0) throw new Error("workflow cancel does not accept additional options.");
    const snapshot = await createRunService().cancelRun(resource);
    printRun(snapshot);
    return 0;
  }

  if (subcommand === "help" || subcommand === undefined) {
    printHelp();
    return 0;
  }

  console.error("Unknown workflow command: " + subcommand);
  printHelp();
  return 2;
}

async function main(args: string[]): Promise<number> {
  const [command = "help", ...rest] = args;

  if (command === "version" || command === "--version" || command === "-v") {
    console.log("Aether " + getAetherVersion());
    return 0;
  }

  if (command === "workflow") {
    try {
      return await runWorkflowCommand(rest);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Workflow command failed.");
      return 1;
    }
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  console.error("Unknown command: " + command);
  printHelp();
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
