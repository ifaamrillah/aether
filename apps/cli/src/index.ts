#!/usr/bin/env node

import { getAetherVersion } from "@aether/core";

const [command = "help"] = process.argv.slice(2);

function printHelp(): void {
  console.log(`Aether — AI Engineering Harness

Usage:
  aether <command>

Commands:
  version   Show CLI and core version
  help      Show this help

More commands will be added incrementally.
`);
}

switch (command) {
  case "version":
  case "--version":
  case "-v":
    console.log(`Aether ${getAetherVersion()}`);
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
}
