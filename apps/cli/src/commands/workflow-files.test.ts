import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listWorkflowFiles } from "./workflow-files.js";

let root: string;

const definition = (id: string, name: string) => `schema_version: 1
id: ${id}
version: 1
name: ${name}
description: Test workflow.
inputs: []
stages:
  - id: work
    skill: implementation
    required: true
completion:
  required_stages:
    - work
`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aether-workflow-list-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("listWorkflowFiles", () => {
  it("lists validated workflows recursively in deterministic path order", async () => {
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(join(root, "z.yaml"), definition("z-workflow", "Zed"));
    await writeFile(join(root, "nested", "a.yml"), definition("a-workflow", "Alpha"));
    await writeFile(join(root, "README.md"), "not a workflow");

    expect(await listWorkflowFiles(root)).toEqual([
      {
        path: "nested/a.yml",
        id: "a-workflow",
        name: "Alpha",
        version: 1,
      },
      {
        path: "z.yaml",
        id: "z-workflow",
        name: "Zed",
        version: 1,
      },
    ]);
  });

  it("returns an empty list for a missing workflow directory", async () => {
    expect(await listWorkflowFiles(join(root, "missing"))).toEqual([]);
  });

  it("rejects invalid workflows and duplicate workflow identifiers", async () => {
    await writeFile(join(root, "a.yaml"), "not: [valid");
    await expect(listWorkflowFiles(root)).rejects.toThrow(/Invalid workflow/);

    await rm(join(root, "a.yaml"));
    await writeFile(join(root, "a.yaml"), definition("same", "First"));
    await writeFile(join(root, "b.yaml"), definition("same", "Second"));
    await expect(listWorkflowFiles(root)).rejects.toThrow(/Duplicate workflow id/);
  });

  it("rejects symbolic links in the workflow tree", async () => {
    const outside = join(root, "..", "external-workflow.yaml");
    await writeFile(outside, definition("outside", "Outside"));
    await import("node:fs/promises").then(({ symlink }) =>
      symlink(outside, join(root, "linked.yaml")),
    );

    await expect(listWorkflowFiles(root)).rejects.toThrow(/symbolic link/);
    await rm(outside, { force: true });
  });
});
