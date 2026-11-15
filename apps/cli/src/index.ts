#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import {
  FileStateStore,
  WorkflowRunService,
  Ed25519ApprovalAuthorizer,
  getAetherVersion,
  planReadyStageTasks,
  verifyTaskResult,
  searchProjectContext,
  auditProjectDocumentation,
} from "@aether/core";
import type { ApprovalDecisionReceipt } from "@aether/core";
import type { StageTaskContract, TaskResultSubmission, TrustedApproverStore } from "@aether/core";
import { createAgentAdapter, runAgentCommand } from "@aether/adapters";
import { inspectAgentPlatforms } from "./commands/platform-info.js";
import {
  validateAgentAdapterDescriptor,
  validateDelegationContract,
  validateTaskResultSubmission,
  validateApprovalDecisionReceipt,
  validateTrustedApproverStore,
} from "@aether/schemas";
import type { AdapterId } from "@aether/adapters";
import {
  parseWorkflowDefinition,
  validateWorkflowContent,
} from "./commands/workflow-validate.js";
import { parseWorkflowRunOptions } from "./commands/workflow-inputs.js";
import { listWorkflowFiles } from "./commands/workflow-files.js";
import { validateSkills } from "./commands/skill-validate.js";
import {
  doctorProject,
  initProject,
  resolveBundledSkillsRoot,
  resolveBundledWorkflowsRoot,
  uninstallProject,
  updateProject,
} from "./commands/project-setup.js";

function printHelp(): void {
  console.log(`Aether — AI Engineering Harness

Usage:
  aether <command>

Commands:
  version                                      Show CLI and core version
  init [options]                               Install Aether skills and initialize project config
  update [options]                             Update unchanged Aether-managed skills
  uninstall [--project <path>]                 Remove unchanged managed files; preserve project config
  doctor [--project <path>]                    Check Aether configuration and managed files
  workflow validate <file>                    Validate workflow YAML and show execution waves
  workflow list [directory]                   List validated workflows (default: workflows/aether)
  skill validate [path]                        Validate portable Agent Skills (default: skills/)
  context search <query> [--limit <n>] [--max-chars <n>] [--project <path>]
                                               Retrieve bounded local project context
  docs audit [--project <path>] [--max-files <n>]
                                               Check local Markdown links and heading anchors
  platform list                                List adapter capabilities and skill paths
  platform detect [--project <path>]           Detect platform markers in a project
  workflow run <file> [--input name=value]     Create and start a workflow run
  workflow status <run-id>                    Show persisted run and pending recovery events
  workflow handoff <run-id> --file <file>      Generate agent handoffs for ready stages
  workflow launch <run-id> --file <file> --adapter <id> [--stage <id>]
                                               Launch one interactive agent CLI stage
  workflow accept <run-id> --file <file> --stage <id> --result <json>
                                               Verify task result and complete its stage
  workflow request-approval <run-id> --file <file> --stage <id> --by <name>
                                               Request approval for an eligible stage
  workflow approve <run-id> --file <file> --stage <id> --receipt <json>
                                               Apply a cryptographically verified approval receipt
  workflow reject <run-id> --file <file> --stage <id> --receipt <json>
                                               Apply a cryptographically verified rejection receipt
  workflow pause <run-id>                     Pause a running workflow
  workflow resume <run-id> --file <file>       Recover if needed, then resume a paused workflow
  workflow recover <run-id> --file <file>      Replay pending events and reconcile run state
  workflow cancel <run-id>                    Cancel a non-terminal workflow run
  help                                         Show this help

Init options:
  --platform <name>                            Repeatable: generic, claude-code, codex, opencode, gemini-cli, antigravity
  --mode greenfield|brownfield                 Project type (default: brownfield)
  --project <path>                             Target project (default: current directory)
  --skills <path>                              Source skill bundle (default: bundled Aether skills)
  --workflows <path>                           Source workflow bundle (default: bundled Aether workflows)
  --dry-run                                    Preview changes without writing files

Handoff options:
  --adapter generic|claude-code|codex|opencode|gemini-cli|antigravity

Input values use YAML scalar syntax:
  --input feature_description="Add account settings"
  --input include_docs=true
  --input retry_limit=3
`);
}

function createRunService(projectId?: string, approvalAuthorizer?: Ed25519ApprovalAuthorizer): WorkflowRunService {
  return new WorkflowRunService({
    projectRoot: process.cwd(),
    projectId: projectId ?? basename(resolve(process.cwd())),
    ...(approvalAuthorizer === undefined ? {} : { approvalAuthorizer }),
  });
}

async function loadTrustedApprovalAuthorizer(): Promise<Ed25519ApprovalAuthorizer> {
  const configuredPath = process.env.AETHER_TRUSTED_APPROVERS_FILE;
  if (!configuredPath) throw new Error("AETHER_TRUSTED_APPROVERS_FILE must point to an externally managed trusted approver registry.");
  if (!isAbsolute(configuredPath)) throw new Error("AETHER_TRUSTED_APPROVERS_FILE must be an absolute path.");
  const projectRoot = await realpath(process.cwd());
  const candidate = resolve(configuredPath);
  const details = await lstat(candidate);
  if (details.isSymbolicLink() || !details.isFile()) throw new Error("Trusted approver registry must be a regular, non-symlink file.");
  if (process.platform !== "win32" && (details.mode & 0o022) !== 0) throw new Error("Trusted approver registry must not be group- or world-writable.");
  const trustedPath = await realpath(candidate);
  if (isInside(projectRoot, trustedPath)) throw new Error("Trusted approver registry must live outside the project workspace.");
  const parsed = JSON.parse(await readFile(trustedPath, "utf8")) as unknown;
  const validation = validateTrustedApproverStore(parsed);
  if (!validation.valid) {
    throw new Error("Trusted approver registry is invalid:\n- " + validation.errors.map((issue) => issue.path + ": " + issue.message).join("\n- "));
  }
  return new Ed25519ApprovalAuthorizer(parsed as TrustedApproverStore);
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
    if (typeof flag !== "string") {
      throw new Error("Invalid option sequence.");
    }
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
    approval_id?: string;
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
    const approval = stage.approval_id ? " | approval " + stage.approval_id : "";
    console.log(
      "  " + stage.stage_id.padEnd(24) + stage.status.padEnd(22) +
      "attempt " + stage.attempt + evidence + approval,
    );
  }
}

function renderContextPack(result: Awaited<ReturnType<typeof searchProjectContext>>): string {
  const lines = [
    "# Retrieved Project Context",
    "",
    "- Query: " + result.query,
    "- Files scanned: " + result.files_scanned,
    "- Files skipped: " + result.files_skipped,
    "- Excerpt budget used: " + result.characters_used,
    "- Truncated: " + (result.truncated ? "yes" : "no"),
    "",
    "These relevance-ranked excerpts are informational context, not verified facts. Check the current source before relying on them. The task contract and applicable project instructions remain authoritative.",
    "",
  ];

  if (result.results.length === 0) {
    lines.push("No matching local project context was found.");
    return lines.join("\n");
  }

  result.results.forEach((item, index) => {
    const longestFence = Math.max(
      2,
      ...Array.from(item.excerpt.matchAll(/\x60+/g), (match) => match[0].length),
    );
    const fence = "\x60".repeat(longestFence + 1);
    lines.push(
      "## " + (index + 1) + ". " + item.path + ":" +
        item.line_start + "-" + item.line_end,
      "",
      "- Relevance score: " + item.score.toFixed(4),
      "- Matched terms: " + item.matched_terms.join(", "),
      "",
      fence,
      item.excerpt,
      fence,
      "",
    );
  });

  return lines.join("\n");
}

async function prepareTaskArtifacts(
  task: StageTaskContract,
  adapter: ReturnType<typeof createAgentAdapter>,
): Promise<{ base: string; handoffPath: string; contextPath: string }> {
  const base = ".aether/handoffs/" + task.run_id + "/" + task.stage_id;
  const handoffPath = base + "/HANDOFF.md";
  const contextPath = base + "/CONTEXT.md";
  const query = [
    task.title,
    task.objective,
    ...task.acceptance_criteria,
  ].join(" ").slice(0, 500);

  const context = await searchProjectContext(query, {
    projectRoot: process.cwd(),
    limit: 5,
    maxCharacters: 3_500,
    maxFiles: 500,
    maxFileBytes: 128 * 1024,
    maxTotalBytes: 4 * 1024 * 1024,
    maxSnippetLines: 10,
  });

  await writeProjectFile(base + "/task.json", JSON.stringify(task, null, 2) + "\n");
  await writeProjectFile(contextPath, renderContextPack(context));
  const handoff = adapter.renderHandoff(task).trimEnd() +
    "\n\n## Retrieved Local Context\n\n" +
    "Read CONTEXT.md before implementation. It contains bounded, relevance-ranked excerpts from this project. " +
    "Use the source paths and line numbers to inspect the current files; do not treat excerpts as verification evidence.\n";
  await writeProjectFile(handoffPath, handoff);

  return { base, handoffPath, contextPath };
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
    const artifacts = await prepareTaskArtifacts(task, adapter);
    console.log("Prepared: " + artifacts.handoffPath);
    console.log("Context: " + artifacts.contextPath);
  }

  console.log("");
  console.log("Prepared " + tasks.length + " task handoff(s). No agent was launched.");
  return 0;
}

async function launchWorkflowStage(
  runId: string,
  args: string[],
): Promise<number> {
  const options = parseOptions(args, ["--file", "--adapter", "--stage"]);
  const filePath = options["--file"];
  const adapterValue = options["--adapter"];
  const requestedStage = options["--stage"];
  if (!filePath || !adapterValue) {
    throw new Error(
      "Usage: workflow launch <run-id> --file <workflow-file> --adapter <claude-code|codex|gemini-cli|antigravity> [--stage <stage-id>]",
    );
  }

  const workflow = await loadWorkflowFile(filePath);
  const adapterId = parseAdapterId(adapterValue);
  const adapter = createAgentAdapter(adapterId);
  const adapterValidation = validateAgentAdapterDescriptor(adapter.descriptor);
  if (!adapterValidation.valid) {
    throw new Error(
      "Adapter descriptor is invalid:\n- " +
        adapterValidation.errors.map((issue) => issue.path + ": " + issue.message).join("\n- "),
    );
  }
  if (adapter.descriptor.execution_mode !== "interactive-cli") {
    throw new Error(
      'Adapter "' + adapterId + '" supports handoff only. Use "workflow handoff" or select an interactive CLI adapter.',
    );
  }

  const service = createRunService();
  let snapshot = await service.getRun(runId);
  if (snapshot.workflow_id !== workflow.id || snapshot.workflow_version !== workflow.version) {
    throw new Error("Workflow definition does not match the run's pinned identity and version.");
  }

  const launchableStages = workflow.stages.filter((definition) => {
    const status = snapshot.stages[definition.id]?.status;
    return status === "ready" || status === "failed";
  });
  let stageId = requestedStage;
  if (!stageId) {
    if (launchableStages.length !== 1) {
      const available = launchableStages.map((stage) => stage.id);
      throw new Error(
        "Select one stage with --stage. Launchable stages: " +
          (available.length > 0 ? available.join(", ") : "none"),
      );
    }
    stageId = launchableStages[0]!.id;
  }

  const stageDefinition = workflow.stages.find((definition) => definition.id === stageId);
  const stageState = snapshot.stages[stageId];
  if (!stageDefinition || !stageState) {
    throw new Error('Unknown stage "' + stageId + '" in workflow "' + workflow.id + '".');
  }
  if (stageState.status !== "ready" && stageState.status !== "failed") {
    throw new Error(
      'Stage "' + stageId + '" must be ready or failed to launch; current status is "' +
        stageState.status + '".',
    );
  }

  const taskSnapshot = stageState.status === "ready"
    ? snapshot
    : {
        ...snapshot,
        stages: {
          ...snapshot.stages,
          [stageId]: { ...stageState, status: "ready" as const },
        },
      };
  const task = planReadyStageTasks(taskSnapshot, workflow, adapterId)
    .find((candidate) => candidate.stage_id === stageId);
  if (!task) {
    throw new Error('Could not construct a launch contract for stage "' + stageId + '".');
  }

  const taskValidation = validateDelegationContract(task);
  if (!taskValidation.valid) {
    throw new Error(
      "Delegation contract is invalid:\n- " +
        taskValidation.errors.map((issue) => issue.path + ": " + issue.message).join("\n- "),
    );
  }

  const artifacts = await prepareTaskArtifacts(task, adapter);
  const handoffPath = artifacts.handoffPath;
  console.log("Context: " + artifacts.contextPath);

  const launch = adapter.buildLaunch(task, handoffPath);
  if (!launch) {
    throw new Error('Adapter "' + adapterId + '" did not provide an interactive launch command.');
  }

  const detected = await adapter.detect(process.cwd());
  console.log(
    "Adapter: " + adapter.descriptor.name +
      (detected ? " (project marker detected)" : " (explicitly selected; no project marker detected)"),
  );
  console.log("Stage: " + stageId);
  for (const note of launch.permission_notes) {
    console.log("Permission: " + note);
  }

  if (stageState.status === "failed") {
    snapshot = await service.transitionStage(runId, workflow, stageId, "ready");
  }
  if (snapshot.stages[stageId]?.status === "ready") {
    snapshot = await service.transitionStage(runId, workflow, stageId, "in_progress");
  }

  console.log("Launching " + launch.command + " for stage " + stageId + "...");
  let result;
  try {
    result = await runAgentCommand(launch, process.cwd());
  } catch (error) {
    const current = await service.getRun(runId);
    if (current.stages[stageId]?.status === "in_progress") {
      await service.transitionStage(
        runId,
        workflow,
        stageId,
        "failed",
        { reason: "The native agent CLI could not be started." },
      );
    }
    throw error;
  }

  if (result.exit_code === 0 && result.signal === null) {
    const current = await service.getRun(runId);
    printRun(current);
    console.log("");
    console.log("Agent process exited successfully (" + result.duration_ms + " ms). The stage remains in progress until its result is accepted.");
    console.log(
      "Next: aether workflow accept " + runId +
        " --file " + filePath + " --stage " + stageId + " --result " + task.expected_result_path,
    );
    return 0;
  }

  const reason = result.signal
    ? "The native agent CLI stopped with signal " + result.signal + "."
    : "The native agent CLI exited with code " + String(result.exit_code) + ".";
  const failed = await service.transitionStage(
    runId,
    workflow,
    stageId,
    "failed",
    { reason },
  );
  printRun(failed);
  console.error(reason);
  return result.exit_code ?? 1;
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

async function runWorkflowApprovalCommand(
  runId: string,
  args: string[],
  action: "request" | "approve" | "reject",
): Promise<number> {
  const options = parseOptions(
    args,
    action === "request" ? ["--file", "--stage", "--by"] : ["--file", "--stage", "--receipt"],
  );
  const filePath = options["--file"];
  const stageId = options["--stage"];
  const requesterLabel = options["--by"];
  const receiptPath = options["--receipt"];
  if (!filePath || !stageId) throw new Error("Missing --file or --stage for workflow approval command.");
  if (action === "request" && !requesterLabel?.trim()) throw new Error("workflow request-approval requires --by <requester-audit-label>. This label is not authenticated.");
  if (action !== "request" && !receiptPath) throw new Error("Approval decisions require --receipt <signed-decision.json>; --by is not accepted.");
  const workflow = await loadWorkflowFile(filePath);
  let snapshot;
  if (action === "request") {
    snapshot = await createRunService().requestStageApproval(runId, workflow, stageId, requesterLabel!);
  } else {
    const parsed = JSON.parse(await readFile(receiptPath!, "utf8")) as unknown;
    const validation = validateApprovalDecisionReceipt(parsed);
    if (!validation.valid) {
      throw new Error("Approval decision receipt is invalid:\n- " + validation.errors.map((issue) => issue.path + ": " + issue.message).join("\n- "));
    }
    const service = createRunService(undefined, await loadTrustedApprovalAuthorizer());
    const receipt = parsed as ApprovalDecisionReceipt;
    snapshot = action === "approve"
      ? await service.approveStage(runId, workflow, stageId, receipt)
      : await service.rejectStage(runId, workflow, stageId, receipt);
  }
  printRun(snapshot);
  if (action === "request") console.log("Approval request recorded. The --by value is an audit label only.");
  if (action === "approve") console.log("Signed approval receipt verified; the stage is ready for handoff.");
  if (action === "reject") console.log("Signed rejection receipt verified; the stage is blocked until revised and re-requested.");
  return 0;
}
async function runWorkflowCommand(args: string[]): Promise<number> {
  const [subcommand, resource, ...options] = args;

  if (subcommand === "list") {
    if (options.length > 0) {
      throw new Error("workflow list accepts at most one optional directory path.");
    }
    const directory = resource ?? "workflows/aether";
    const entries = await listWorkflowFiles(directory);
    if (entries.length === 0) {
      console.log("No workflow definitions found in " + resolve(directory) + ".");
      return 0;
    }

    console.log("Workflows in " + resolve(directory) + ":");
    for (const entry of entries) {
      console.log(
        "  " + entry.id.padEnd(28) +
          "v" + entry.version + "  " + entry.name +
          "  (" + entry.path + ")",
      );
    }
    console.log(entries.length + " workflow(s) available.");
    return 0;
  }

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
    const approvalStage = Object.values(started.stages).find(
      (stage) => stage.status === "awaiting_approval",
    );
    if (approvalStage) {
      console.log(
        "Next: aether workflow approve " + started.id + " --file " + resource +
          " --stage " + approvalStage.stage_id + " --receipt <signed-receipt.json>",
      );
    } else {
      console.log("Next: aether workflow handoff " + started.id + " --file " + resource);
    }
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

  if (subcommand === "launch") {
    if (!resource) throw new Error("Usage: aether workflow launch <run-id> --file <workflow-file> --adapter <id> [--stage <stage-id>]");
    return launchWorkflowStage(resource, options);
  }

  if (subcommand === "handoff") {
    if (!resource) throw new Error("Usage: aether workflow handoff <run-id> --file <workflow-file>");
    return handoffWorkflow(resource, options);
  }

  if (subcommand === "accept") {
    if (!resource) throw new Error("Usage: aether workflow accept <run-id> --file <workflow-file> --stage <id> --result <result.json>");
    return acceptWorkflowTask(resource, options);
  }

  if (subcommand === "request-approval") {
    if (!resource) throw new Error("Usage: aether workflow request-approval <run-id> --file <workflow-file> --stage <id> --by <name>");
    return runWorkflowApprovalCommand(resource, options, "request");
  }

  if (subcommand === "approve" || subcommand === "reject") {
    if (!resource) throw new Error("Usage: aether workflow " + subcommand + " <run-id> --file <workflow-file> --stage <id> --receipt <signed-decision.json>");
    return runWorkflowApprovalCommand(resource, options, subcommand);
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
    const approvalAuthorizer = process.env.AETHER_TRUSTED_APPROVERS_FILE
      ? await loadTrustedApprovalAuthorizer()
      : undefined;
    const service = createRunService(undefined, approvalAuthorizer);

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

function parsePositiveIntegerOption(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(label + " must be a positive integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(label + " must be a positive integer.");
  }
  return parsed;
}

async function runContextCommand(args: string[]): Promise<number> {
  const [subcommand, ...values] = args;
  if (subcommand !== "search") {
    throw new Error("Usage: aether context search <query> [--limit <n>] [--max-chars <n>] [--project <path>]");
  }

  const firstOptionIndex = values.findIndex((value) => value.startsWith("--"));
  const queryParts = firstOptionIndex < 0 ? values : values.slice(0, firstOptionIndex);
  const optionArgs = firstOptionIndex < 0 ? [] : values.slice(firstOptionIndex);
  const query = queryParts.join(" ").trim();
  if (!query) {
    throw new Error("Usage: aether context search <query> [--limit <n>] [--max-chars <n>] [--project <path>]");
  }

  const options = parseOptions(optionArgs, ["--limit", "--max-chars", "--project"]);
  const projectRoot = resolve(options["--project"] ?? process.cwd());
  const limit = parsePositiveIntegerOption(options["--limit"], "--limit");
  const maxCharacters = parsePositiveIntegerOption(options["--max-chars"], "--max-chars");
  const result = await searchProjectContext(query, {
    projectRoot,
    ...(limit === undefined ? {} : { limit }),
    ...(maxCharacters === undefined ? {} : { maxCharacters }),
  });

  console.log("Project context search: " + result.query);
  console.log(
    "Scanned " + result.files_scanned + " text file(s); skipped " +
      result.files_skipped + "; budget used " + result.characters_used + " character(s)." +
      (result.truncated ? " Results are truncated." : ""),
  );
  if (result.results.length === 0) {
    console.log("No matching project context found.");
    return 0;
  }

  result.results.forEach((item, index) => {
    console.log("");
    console.log(
      "[" + (index + 1) + "] " + item.path + ":" +
        item.line_start + "-" + item.line_end +
        " (score " + item.score.toFixed(2) + ")",
    );
    console.log("Matched: " + item.matched_terms.join(", "));
    console.log(item.excerpt);
  });

  if (result.truncated) {
    console.log("");
    console.log("Increase --limit or --max-chars to retrieve more context.");
  }
  return 0;
}

async function runDocumentationCommand(args: string[]): Promise<number> {
  const [subcommand, ...values] = args;
  if (subcommand !== "audit") {
    throw new Error("Usage: aether docs audit [--project <path>] [--max-files <n>]");
  }

  const options = parseOptions(values, ["--project", "--max-files"]);
  const projectRoot = resolve(options["--project"] ?? process.cwd());
  const maxFiles = parsePositiveIntegerOption(options["--max-files"], "--max-files");
  const result = await auditProjectDocumentation({
    projectRoot,
    ...(maxFiles === undefined ? {} : { maxFiles }),
  });

  console.log(
    "Checked " + result.filesChecked + " Markdown file(s) and " +
      result.linksChecked + " local link(s).",
  );
  if (result.filesSkipped > 0) {
    console.log("Skipped " + result.filesSkipped + " unreadable or unsafe file(s).");
  }
  if (result.truncated) {
    console.error("Documentation audit was truncated by its resource limits.");
  }

  for (const link of result.brokenLinks) {
    console.error(
      link.sourcePath + ":" + link.line + ": " + link.href + " - " + link.reason +
        (link.targetPath ? " (" + link.targetPath + ")" : ""),
    );
  }

  if (result.brokenLinks.length > 0 || result.truncated) {
    console.error(
      result.brokenLinks.length + " broken local link or anchor reference(s) found.",
    );
    return 1;
  }

  console.log("No broken internal links found.");
  return 0;
}

async function runPlatformCommand(args: string[]): Promise<number> {
  const [subcommand, ...options] = args;

  if (subcommand === "list") {
    if (options.length > 0) throw new Error("platform list does not accept options.");
    const platforms = await inspectAgentPlatforms(process.cwd());
    for (const platform of platforms) {
      const descriptor = platform.descriptor;
      const capabilitySummary = descriptor.capabilities
        .map((capability) => capability.id + "=" + capability.status)
        .join(", ");
      console.log(descriptor.id);
      console.log("  Name: " + descriptor.name);
      console.log("  Skill path: " + descriptor.skill_install_path);
      console.log("  Handoff mode: " + descriptor.handoff_mode);
      console.log("  Project detected: " + (platform.detected ? "yes" : "no"));
      console.log("  Capabilities: " + capabilitySummary);
    }
    return 0;
  }

  if (subcommand === "detect") {
    const parsed = parseOptions(options, ["--project"]);
    const projectRoot = resolve(parsed["--project"] ?? process.cwd());
    const platforms = await inspectAgentPlatforms(projectRoot);
    console.log("Project: " + projectRoot);
    for (const platform of platforms) {
      const descriptor = platform.descriptor;
      console.log(
        (platform.detected ? "DETECTED " : "not detected ") +
        descriptor.id.padEnd(14) +
        descriptor.skill_install_path,
      );
    }
    return 0;
  }

  if (subcommand === "help" || subcommand === undefined) {
    console.log("Usage: aether platform list | platform detect [--project <path>]");
    return 0;
  }

  throw new Error("Unknown platform command: " + subcommand);
}

async function runSkillCommand(args: string[]): Promise<number> {
  const [subcommand, target, ...extra] = args;
  if (subcommand !== "validate") {
    if (subcommand === "help" || subcommand === undefined) {
      console.log("Usage: aether skill validate [path]");
      return 0;
    }
    throw new Error("Unknown skill command: " + subcommand);
  }
  if (extra.length > 0) throw new Error("skill validate accepts at most one path.");
  const targetPath = target ?? "skills";
  const results = await validateSkills(targetPath);
  let errorCount = 0;
  let warningCount = 0;

  for (const result of results) {
    console.log((result.valid ? "PASS " : "FAIL ") + result.path);
    for (const issue of result.issues) {
      if (issue.severity === "error") errorCount += 1;
      else warningCount += 1;
      console.log("  " + issue.severity.toUpperCase() + " [" + issue.code + "] " + issue.message);
    }
  }

  console.log(
    "Validated " + results.length + " skill(s): " +
      results.filter((result) => result.valid).length + " valid, " +
      errorCount + " error(s), " + warningCount + " warning(s).",
  );
  return errorCount === 0 ? 0 : 1;
}

function parseInitArguments(args: string[]): {
  projectRoot: string;
  platforms: AdapterId[];
  mode: "greenfield" | "brownfield";
  skillsRoot?: string;
  workflowsRoot?: string;
  dryRun: boolean;
} {
  const platforms: AdapterId[] = [];
  let projectRoot = process.cwd();
  let mode: "greenfield" | "brownfield" = "brownfield";
  let skillsRoot: string | undefined;
  let workflowsRoot: string | undefined;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (typeof flag !== "string") throw new Error("Invalid init option sequence.");

    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (
      flag !== "--platform" &&
      flag !== "--mode" &&
      flag !== "--project" &&
      flag !== "--skills" &&
      flag !== "--workflows"
    ) {
      throw new Error('Unknown init option "' + flag + '".');
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("Missing value after " + flag + ".");
    }
    index += 1;

    if (flag === "--platform") {
      platforms.push(parseAdapterId(value));
    } else if (flag === "--mode") {
      if (value !== "greenfield" && value !== "brownfield") {
        throw new Error("--mode must be greenfield or brownfield.");
      }
      mode = value;
    } else if (flag === "--project") {
      projectRoot = resolve(value);
    } else if (flag === "--skills") {
      skillsRoot = resolve(value);
    } else if (flag === "--workflows") {
      workflowsRoot = resolve(value);
    }
  }

  return {
    projectRoot,
    platforms: platforms.length > 0 ? [...new Set(platforms)] : ["generic"],
    mode,
    ...(skillsRoot === undefined ? {} : { skillsRoot }),
    ...(workflowsRoot === undefined ? {} : { workflowsRoot }),
    dryRun,
  };
}

async function runInitCommand(args: string[]): Promise<number> {
  const options = parseInitArguments(args);
  const [skillsRoot, workflowsRoot] = await Promise.all([
    options.skillsRoot ?? resolveBundledSkillsRoot(),
    options.workflowsRoot ?? resolveBundledWorkflowsRoot(),
  ]);
  const result = await initProject({
    ...options,
    skillsRoot,
    workflowsRoot,
  });

  console.log("Initialized Aether project: " + result.projectRoot);
  console.log("Platforms: " + result.destinations.join(", "));
  console.log("Workflow directory: workflows/aether");
  console.log("Project config: " + result.config);
  console.log("Managed-file manifest: " + result.manifest);
  console.log(
    "Managed files: " + result.installed.length + " installed, " +
      result.updated.length + " updated, " +
      result.unchanged.length + " unchanged.",
  );
  for (const conflict of result.conflicts) {
    console.warn("Preserved " + conflict.path + ": " + conflict.reason);
  }
  if (result.conflicts.length > 0) {
    console.warn(result.conflicts.length + " file conflict(s) were preserved without overwrite.");
  }
  if (options.dryRun) console.log("Dry run: no project files were changed.");
  return 0;
}

async function runDoctorCommand(args: string[]): Promise<number> {
  let projectRoot = process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--project") throw new Error('Unknown doctor option "' + flag + '".');
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value after --project.");
    projectRoot = resolve(value);
    index += 1;
  }

  const result = await doctorProject(projectRoot);
  for (const check of result.checks) {
    const label = check.status.toUpperCase().padEnd(7);
    const output = label + check.name + ": " + check.message;
    if (check.status === "fail") console.error(output);
    else if (check.status === "warning") console.warn(output);
    else console.log(output);
  }
  console.log(
    "Doctor: " + result.passed + " passed, " +
      result.warnings + " warning(s), " +
      result.failed + " failure(s).",
  );
  return result.failed === 0 ? 0 : 1;
}

async function runUpdateCommand(args: string[]): Promise<number> {
  let projectRoot = process.cwd();
  let skillsRoot: string | undefined;
  let workflowsRoot: string | undefined;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (flag !== "--project" && flag !== "--skills" && flag !== "--workflows") {
      throw new Error('Unknown update option "' + flag + '".');
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value after " + flag + ".");
    if (flag === "--project") projectRoot = resolve(value);
    else if (flag === "--skills") skillsRoot = resolve(value);
    else workflowsRoot = resolve(value);
    index += 1;
  }

  const result = await updateProject({
    projectRoot,
    ...(skillsRoot === undefined ? {} : { skillsRoot }),
    ...(workflowsRoot === undefined ? {} : { workflowsRoot }),
    dryRun,
  });
  console.log("Updated Aether project: " + result.projectRoot);
  console.log(
    result.installed.length + " installed, " + result.updated.length +
      " updated, " + result.unchanged.length + " unchanged.",
  );
  for (const conflict of result.conflicts) {
    console.warn("Preserved " + conflict.path + ": " + conflict.reason);
  }
  if (dryRun) console.log("Dry run: no project files were changed.");
  return 0;
}

async function runUninstallCommand(args: string[]): Promise<number> {
  let projectRoot = process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--project") throw new Error('Unknown uninstall option "' + flag + '".');
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value after --project.");
    projectRoot = resolve(value);
    index += 1;
  }

  const result = await uninstallProject(projectRoot);
  console.log("Uninstalled Aether-managed files from " + resolve(projectRoot));
  console.log(result.removed.length + " file(s) removed; " + result.alreadyMissing.length + " already missing.");
  for (const item of result.preserved) {
    console.warn("Preserved " + item.path + ": " + item.reason);
  }
  console.log("Project config was preserved. Remove .aether/config.yaml manually only when you no longer need it.");
  return 0;
}

async function main(args: string[]): Promise<number> {
  const [command = "help", ...rest] = args;

  if (command === "version" || command === "--version" || command === "-v") {
    console.log("Aether " + getAetherVersion());
    return 0;
  }

  if (command === "init") {
    try {
      return await runInitCommand(rest);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Aether initialization failed.");
      return 1;
    }
  }

  if (command === "doctor") {
    try {
      return await runDoctorCommand(rest);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Aether doctor failed.");
      return 1;
    }
  }

  if (command === "update") {
    try {
      return await runUpdateCommand(rest);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Aether update failed.");
      return 1;
    }
  }

  if (command === "uninstall") {
    try {
      return await runUninstallCommand(rest);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Aether uninstall failed.");
      return 1;
    }
  }

  if (command === "workflow") {
    try {
      return await runWorkflowCommand(rest);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Workflow command failed.");
      return 1;
    }
  }

  if (command === "skill") {
    try {
      return await runSkillCommand(rest);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Skill command failed.");
      return 1;
    }
  }

  if (command === "docs") {
    try {
      return await runDocumentationCommand(rest);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Documentation audit failed.");
      return 1;
    }
  }

  if (command === "context") {
    try {
      return await runContextCommand(rest);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Context search failed.");
      return 1;
    }
  }

  if (command === "platform") {
    try {
      return await runPlatformCommand(rest);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Platform command failed.");
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
