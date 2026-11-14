#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { getAetherVersion } from "@aether/core";
import { validateWorkflowContent } from "./commands/workflow-validate.js";

function printHelp(): void {
  console.log(`Aether — AI Engineering Harness

Usage:
  aether <command>

Commands:
  version                         Show CLI and core version
  workflow validate <file>        Validate a workflow YAML file and show execution waves
  help                            Show this help
`);
}

async function main(args: string[]): Promise<number> {
  const [command = "help", subcommand, filePath] = args;

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(`Aether ${getAetherVersion()}`);
    return 0;
  }

  if (command === "workflow" && subcommand === "validate") {
    if (!filePath) {
      console.error("Missing workflow file path.");
      console.error("Usage: aether workflow validate <file>");
      return 2;
    }

    try {
      const content = await readFile(filePath, "utf8");
      const result = validateWorkflowContent(content);

      if (!result.ok) {
        console.error("Workflow validation failed:");
        for (const error of result.errors) console.error(`- ${error}`);
        return 1;
      }

      console.log(`Workflow valid: ${result.workflowId} (v${result.version})`);
      console.log("Execution waves:");
      result.waves.forEach((wave, index) => {
        console.log(`  ${index + 1}. ${wave.join(", ")}`);
      });
      return 0;
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Unable to read workflow file.",
      );
      return 1;
    }
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  console.error(`Unknown command: ${args.join(" ")}`);
  printHelp();
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
