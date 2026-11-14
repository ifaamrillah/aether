import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentAdapter, listAgentAdapters } from "./index.js";
import type { StageTaskContract } from "@aether/core";

let root: string;

const task: StageTaskContract = {
  schema_version: 1,
  task_id: "task_run_123_implementation",
  run_id: "run_123",
  workflow_id: "feature",
  workflow_version: 1,
  stage_id: "implementation",
  title: "Implement feature",
  objective: "Build the feature described in the approved specification.",
  suggested_role: "Software Engineer",
  adapter_id: "generic",
  dependencies: ["task_run_123_planning"],
  file_scope: {
    read_paths: ["src/**", "docs/specs/**"],
    write_paths: ["src/**", "tests/**"],
  },
  output_paths: [".aether/handoffs/run_123/implementation/output/**"],
  acceptance_criteria: ["Unit tests pass", "Attach test report"],
  expected_result_path: ".aether/handoffs/run_123/implementation/result.json",
  created_at: "2026-11-15T00:00:00.000Z",
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aether-adapter-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("agent adapters", () => {
  it("lists adapters without claiming unsupported native execution", () => {
    const descriptors = listAgentAdapters();
    expect(descriptors.map((item) => item.id)).toEqual([
      "generic", "claude-code", "codex", "opencode", "gemini-cli", "antigravity",
    ]);
    for (const item of descriptors) {
      expect(item.handoff_mode).toBe("human-mediated");
      expect(item.skill_install_path).toMatch(/^\\.[a-z-]+\\/skills$/);
      expect(item.capabilities.find((capability) => capability.id === "native_subagents")?.status)
        .toBe("unsupported");
    }
  });

  it("declares the platform-native skill installation directory", () => {
    const locations = Object.fromEntries(
      listAgentAdapters().map((item) => [item.id, item.skill_install_path]),
    );
    expect(locations).toEqual({
      generic: ".agents/skills",
      "claude-code": ".claude/skills",
      codex: ".agents/skills",
      opencode: ".opencode/skills",
      "gemini-cli": ".gemini/skills",
      antigravity: ".agents/skills",
    });
  });

  it("always detects generic handoff", async () => {
    expect(await createAgentAdapter("generic").detect(root)).toBe(true);
  });

  it("detects a Claude Code project marker", async () => {
    await mkdir(join(root, ".claude"));
    expect(await createAgentAdapter("claude-code").detect(root)).toBe(true);
    expect(await createAgentAdapter("codex").detect(root)).toBe(false);
  });

  it("detects Gemini CLI and Antigravity project conventions", async () => {
    await mkdir(join(root, ".gemini"));
    expect(await createAgentAdapter("gemini-cli").detect(root)).toBe(true);
    await rm(join(root, ".gemini"), { recursive: true, force: true });
    await mkdir(join(root, ".agents", "skills"), { recursive: true });
    expect(await createAgentAdapter("antigravity").detect(root)).toBe(true);
  });

  it("renders a bounded handoff with a result contract", () => {
    const rendered = createAgentAdapter("generic").renderHandoff(task);
    expect(rendered).toContain(task.task_id);
    expect(rendered).toContain("src/**");
    expect(rendered).toContain("Do not modify files outside");
    expect(rendered).toContain("Task output paths");
    expect(rendered).toContain(".aether/handoffs/run_123/implementation/output/evidence.md");
    expect(rendered).toContain("result.json");
    expect(rendered).toContain('"schema_version": 1');
    expect(rendered).toContain("not an OS sandbox");
  });
});
