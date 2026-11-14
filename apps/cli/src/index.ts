#!/usr/bin/env node

import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  FileStateStore,
  WorkflowRunService,
  getAetherVersion,
} from "@aether/core";
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
  workflow pause <run-id>                     Pause a running workflow
  workflow resume <run-id> --file <file>       Recover if needed, then resume a paused workflow
  workflow recover <run-id> --file <file>      Replay pending events and reconcile run state
  workflow cancel <run-id>                    Cancel a non-terminal workflow run
  help                                         Show this help

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

function readFileFlag(args: string[]): string {
  let filePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--file") {
      throw new Error('Unknown option "' + args[index] + '". Expected --file <workflow-file>.');
    }
    if (filePath !== undefined) {
      throw new Error("--file can only be provided once.");
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("Missing workflow file after --file.");
    }
    filePath = value;
    index += 1;
  }
  if (!filePath) {
    throw new Error("Missing --file <workflow-file>.");
  }
  return filePath;
}

function printRun(snapshot: {
  id: string;
  workflow_id: string;
  workflow_version: number;
  status: string;
  stages: Record<string, { stage_id: string; status: string; attempt: number }>;
}): void {
  console.log("Run: " + snapshot.id);
  console.log("Workflow: " + snapshot.workflow_id + "@" + snapshot.workflow_version);
  console.log("Status: " + snapshot.status);
  console.log("Stages:");
  for (const stage of Object.values(snapshot.stages)) {
    console.log(
      "  " + stage.stage_id.padEnd(24) + stage.status.padEnd(22) +
      "attempt " + stage.attempt,
    );
  }
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
    console.log("The ready stages are prepared for agent execution; this CLI does not launch agents yet.");
    return 0;
  }

  if (subcommand === "status") {
    if (!resource) {
      console.error("Usage: aether workflow status <run-id>");
      return 2;
    }
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

  if (subcommand === "pause") {
    if (!resource) {
      console.error("Usage: aether workflow pause <run-id>");
      return 2;
    }
    if (options.length > 0) throw new Error("workflow pause does not accept additional options.");
    const snapshot = await createRunService().pauseRun(resource);
    printRun(snapshot);
    return 0;
  }

  if (subcommand === "resume" || subcommand === "recover") {
    if (!resource) {
      console.error("Usage: aether workflow " + subcommand + " <run-id> --file <workflow-file>");
      return 2;
    }
    const filePath = readFileFlag(options);
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
    if (!resource) {
      console.error("Usage: aether workflow cancel <run-id>");
      return 2;
    }
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
