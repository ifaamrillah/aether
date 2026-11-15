import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditProjectDocumentation } from "./documentation-audit.js";

let root: string;

async function writeProjectFile(path: string, content: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aether-doc-audit-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("auditProjectDocumentation", () => {
  it("checks relative paths, anchors, duplicate headings, and ignores code examples", async () => {
    const tick = "\x60";
    await writeProjectFile(
      "README.md",
      [
        "# Home",
        "[guide](docs/guide.md#setup)",
        "[self](#home)",
        "[missing file](missing.md)",
        "[missing heading](docs/guide.md#not-here)",
        "[duplicate heading](docs/guide.md#repeat-1)",
        "[external](https://example.com/docs)",
        "Inline example: " + tick + "[not a link](missing-inline.md)" + tick,
        tick.repeat(3) + "md",
        "[also not a link](missing-fenced.md)",
        tick.repeat(3),
      ].join("\n"),
    );
    await writeProjectFile(
      "docs/guide.md",
      [
        "# Setup",
        "",
        "## Repeat",
        "",
        "## Repeat",
        "",
        "## Explicit ID {#custom-anchor}",
      ].join("\n"),
    );

    const result = await auditProjectDocumentation({ projectRoot: root });

    expect(result.filesChecked).toBe(2);
    expect(result.linksChecked).toBe(5);
    expect(result.brokenLinks).toHaveLength(2);
    expect(result.brokenLinks.map((link) => link.href)).toEqual([
      "missing.md",
      "docs/guide.md#not-here",
    ]);
    expect(result.brokenLinks[0]?.line).toBe(4);
    expect(result.brokenLinks[1]?.line).toBe(5);
  });

  it("resolves project-root links, extensionless Markdown routes, and explicit IDs", async () => {
    await writeProjectFile(
      "README.md",
      [
        "[root]( /docs/guide#setup )",
        "[extensionless](docs/guide#custom-anchor)",
      ].join("\n"),
    );
    await writeProjectFile("docs/guide.md", "# Setup\n\n## Custom {#custom-anchor}\n");

    const result = await auditProjectDocumentation({ projectRoot: root });

    expect(result.linksChecked).toBe(2);
    expect(result.brokenLinks).toHaveLength(0);
  });

  it("checks self-referential heading anchors in nested documents", async () => {
    await writeProjectFile(
      "docs/guide.md",
      "# Guide\n\n[valid](#guide)\n[invalid](#missing)\n",
    );

    const result = await auditProjectDocumentation({ projectRoot: root });

    expect(result.linksChecked).toBe(2);
    expect(result.brokenLinks.map((link) => link.href)).toEqual(["#missing"]);
    expect(result.brokenLinks[0]?.targetPath).toBe("docs/guide.md");
  });

  it("reports links that escape the project root", async () => {
    await writeProjectFile("README.md", "[escape](../../outside.md)\n");

    const result = await auditProjectDocumentation({ projectRoot: root });

    expect(result.brokenLinks).toHaveLength(1);
    expect(result.brokenLinks[0]?.reason).toContain("outside the project root");
  });

  it("uses gitignore-aware markdown collection", async () => {
    await writeProjectFile(".gitignore", "private/\n");
    await writeProjectFile("README.md", "# Home\n");
    await writeProjectFile("private/secret.md", "# Hidden\n");

    const result = await auditProjectDocumentation({ projectRoot: root });

    expect(result.filesChecked).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("rejects invalid audit budgets and missing project roots", async () => {
    await expect(auditProjectDocumentation({
      projectRoot: root,
      maxFiles: 0,
    })).rejects.toThrow(/maxFiles must be a positive integer/);
    await expect(auditProjectDocumentation({
      projectRoot: join(root, "missing"),
    })).rejects.toThrow(/Project root does not exist/);
  });
});
