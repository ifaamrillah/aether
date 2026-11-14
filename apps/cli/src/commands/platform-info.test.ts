import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectAgentPlatforms, isAdapterId } from "./platform-info.js";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "aether-platform-info-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("inspectAgentPlatforms", () => {
  it("detects platform markers while keeping runtime capability status independent", async () => {
    await mkdir(join(projectRoot, ".claude"));
    await mkdir(join(projectRoot, ".gemini"));
    await writeFile(join(projectRoot, "GEMINI.md"), "# Project instructions\n");

    const result = await inspectAgentPlatforms(projectRoot);
    const detected = result.filter((item) => item.detected);
    expect(detected.map((item) => item.descriptor.id)).toContain("generic");
    expect(detected.map((item) => item.descriptor.id)).toContain("claude-code");
    expect(detected.map((item) => item.descriptor.id)).toContain("gemini-cli");

    const claude = result.find((item) => item.descriptor.id === "claude-code")!;
    expect(claude.descriptor.capabilities.find((capability) => capability.id === "native_subagents")?.status)
      .toBe("unsupported");
  });

  it("reports the portable handoff option even without platform markers", async () => {
    const result = await inspectAgentPlatforms(projectRoot);
    expect(result.find((item) => item.descriptor.id === "generic")?.detected).toBe(true);
    expect(result.find((item) => item.descriptor.id === "codex")?.detected).toBe(false);
  });
});

describe("isAdapterId", () => {
  it("accepts known adapter IDs and rejects unknown names", () => {
    expect(isAdapterId("claude-code")).toBe(true);
    expect(isAdapterId("gemini-cli")).toBe(true);
    expect(isAdapterId("unknown")).toBe(false);
  });
});
