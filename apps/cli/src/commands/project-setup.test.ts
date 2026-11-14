import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  doctorProject,
  initProject,
  updateProject,
  uninstallProject,
  type InitProjectOptions,
} from "./project-setup.js";

let projectRoot: string;
let skillsRoot: string;
let currentTime: number;

async function createSkill(
  group: string,
  name: string,
  contents = "export const value = 1;\n",
): Promise<void> {
  const directory = join(skillsRoot, group, name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    "---\nname: " + name + "\ndescription: A test skill for setup validation.\nlicense: MIT\n---\n# Test Skill\n\nUse this skill in test fixtures.\n",
    "utf8",
  );
  await mkdir(join(directory, "scripts"), { recursive: true });
  await writeFile(join(directory, "scripts", "helper.js"), contents, "utf8");
}

function options(platforms: InitProjectOptions["platforms"] = ["generic"]): InitProjectOptions {
  return {
    projectRoot,
    skillsRoot,
    platforms,
    clock: () => new Date(currentTime),
  };
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "aether-project-init-"));
  skillsRoot = await mkdtemp(join(tmpdir(), "aether-skill-source-"));
  currentTime = Date.parse("2026-11-15T02:00:00.000Z");
  await createSkill("engineering", "implementation");
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(skillsRoot, { recursive: true, force: true });
});

describe("project initialization", () => {
  it("installs skills into the generic interoperable location", async () => {
    const result = await initProject(options());
    expect(result.installed).toContain(".agents/skills/implementation/SKILL.md");
    expect(result.config).toBe("created");
    expect(result.manifest).toBe("created");

    const installed = await readFile(
      join(projectRoot, ".agents", "skills", "implementation", "SKILL.md"),
      "utf8",
    );
    expect(installed).toContain("name: implementation");
    expect(await readFile(join(projectRoot, ".aether", "config.yaml"), "utf8"))
      .toContain("autonomy: balanced");
  });

  it("deduplicates platforms that share a skill destination", async () => {
    const result = await initProject(options(["codex", "antigravity"]));
    expect(result.destinations).toEqual([".agents/skills"]);
    expect(result.installed.filter((path) => path.endsWith("/SKILL.md"))).toHaveLength(1);
  });

  it("installs Gemini CLI skills into its dedicated project discovery directory", async () => {
    const result = await initProject(options(["gemini-cli"]));
    expect(result.destinations).toEqual([".gemini/skills"]);
    expect(result.installed).toContain(".gemini/skills/implementation/SKILL.md");
  });

  it("preserves user-owned files and does not overwrite them", async () => {
    const destination = join(projectRoot, ".agents", "skills", "implementation");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "SKILL.md"), "user-owned content", "utf8");

    const result = await initProject(options());
    expect(result.conflicts.some((item) => item.path.endsWith("/SKILL.md"))).toBe(true);
    expect(await readFile(join(destination, "SKILL.md"), "utf8")).toBe("user-owned content");
  });

  it("preserves modified Aether-managed files on subsequent init", async () => {
    await initProject(options());
    const destination = join(projectRoot, ".agents", "skills", "implementation", "SKILL.md");
    await writeFile(destination, "user changed this after install", "utf8");

    const result = await initProject(options());
    expect(result.conflicts.some((item) => item.reason.includes("modified by a user"))).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("user changed this after install");
  });

  it("supports dry run without writing project files", async () => {
    const result = await initProject({ ...options(), dryRun: true });
    expect(result.installed).toContain(".agents/skills/implementation/SKILL.md");
    await expect(readFile(join(projectRoot, ".aether", "config.yaml"), "utf8")).rejects.toThrow();
  });

  it("updates unchanged managed files when the bundled skill changes", async () => {
    await initProject(options());
    await writeFile(
      join(skillsRoot, "engineering", "implementation", "scripts", "helper.js"),
      "export const value = 2;\\n",
      "utf8",
    );

    const result = await updateProject({ projectRoot, skillsRoot });
    expect(result.updated).toContain(".agents/skills/implementation/scripts/helper.js");
    expect(
      await readFile(
        join(projectRoot, ".agents", "skills", "implementation", "scripts", "helper.js"),
        "utf8",
      ),
    ).toContain("value = 2");
  });

  it("uninstalls only unmodified managed files and preserves user edits", async () => {
    await initProject(options());
    const skillFile = join(projectRoot, ".agents", "skills", "implementation", "SKILL.md");
    await writeFile(skillFile, "user-edited skill", "utf8");

    const result = await uninstallProject(projectRoot);
    expect(result.removed).toContain(".agents/skills/implementation/scripts/helper.js");
    expect(result.preserved.some((item) => item.path.endsWith("/SKILL.md"))).toBe(true);
    expect(await readFile(skillFile, "utf8")).toBe("user-edited skill");
    await expect(readFile(join(projectRoot, ".aether", "config.yaml"), "utf8"))
      .resolves.toContain("autonomy: balanced");
  });

  it("returns an empty result when uninstall has no managed manifest", async () => {
    const result = await uninstallProject(projectRoot);
    expect(result.removed).toEqual([]);
    expect(result.preserved).toEqual([]);
    expect(result.manifestRemoved).toBe(false);
  });

  it("doctor validates initialized config and managed file checksums", async () => {
    await initProject(options(["claude-code"]));
    const result = await doctorProject(projectRoot);
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThan(0);
  });

  it("doctor warns when a managed skill has been modified", async () => {
    await initProject(options());
    await writeFile(
      join(projectRoot, ".agents", "skills", "implementation", "SKILL.md"),
      "modified",
      "utf8",
    );
    const result = await doctorProject(projectRoot);
    expect(result.warnings).toBeGreaterThan(0);
  });
});
