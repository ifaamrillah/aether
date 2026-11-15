import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentLaunchError, runAgentCommand } from "./runner.js";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "aether-agent-runner-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("runAgentCommand", () => {
  it("starts a process without a shell and returns its exit code", async () => {
    const result = await runAgentCommand({
      adapter_id: "codex",
      command: process.execPath,
      args: ["-e", "process.exit(7)"],
      permission_notes: [],
    }, projectRoot, { stdio: "ignore" });

    expect(result.exit_code).toBe(7);
    expect(result.signal).toBeNull();
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("reports a missing platform executable clearly", async () => {
    await expect(runAgentCommand({
      adapter_id: "claude-code",
      command: "aether-test-command-that-does-not-exist",
      args: [],
      permission_notes: [],
    }, projectRoot, { stdio: "ignore" })).rejects.toBeInstanceOf(AgentLaunchError);
  });
});
