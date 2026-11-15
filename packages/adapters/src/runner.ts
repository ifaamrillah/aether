import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { AgentLaunchSpec } from "./types.js";

export interface AgentCommandResult {
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  duration_ms: number;
}

export class AgentLaunchError extends Error {
  constructor(
    readonly command: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentLaunchError";
  }
}

/**
 * Starts a native agent CLI without a shell and inherits the caller's terminal.
 * Inheriting a TTY is intentional: the platform keeps ownership of interactive
 * permission prompts instead of Aether silently approving tool operations.
 */
export function runAgentCommand(
  launch: AgentLaunchSpec,
  projectRoot: string,
  options: { stdio?: "inherit" | "ignore" } = {},
): Promise<AgentCommandResult> {
  const startedAt = Date.now();

  return new Promise((resolveResult, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(launch.command, launch.args, {
        cwd: resolve(projectRoot),
        env: process.env,
        shell: false,
        windowsHide: false,
        stdio: options.stdio ?? "inherit",
      });
    } catch (error) {
      reject(new AgentLaunchError(
        launch.command,
        "Unable to start " + launch.command + ". Check that the platform CLI is installed.",
        { cause: error },
      ));
      return;
    }

    child.once("error", (error) => {
      reject(new AgentLaunchError(
        launch.command,
        "Unable to start " + launch.command + ". Check that the platform CLI is installed and available on PATH.",
        { cause: error },
      ));
    });

    child.once("close", (exitCode, signal) => {
      resolveResult({
        exit_code: exitCode,
        signal,
        duration_ms: Date.now() - startedAt,
      });
    });
  });
}
