import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectContextSearchError, searchProjectContext } from "./retrieval.js";

let root: string;

async function writeProjectFile(path: string, content: string | Buffer): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aether-project-context-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("searchProjectContext", () => {
  it("ranks relevant source and documentation with deterministic line references", async () => {
    await writeProjectFile(
      "docs/workflow-recovery.md",
      [
        "# Workflow recovery",
        "",
        "The workflow recovery service replays the event journal.",
        "Persisted workflow run state is reconciled before a paused run resumes.",
      ].join("\n"),
    );
    await writeProjectFile(
      "src/workflow.ts",
      "export function workflow() { return 'workflow engine'; }\n",
    );
    await writeProjectFile(
      "README.md",
      "# Example project\n\nThis project contains a workflow.\n",
    );

    const options = { projectRoot: root, limit: 5 };
    const first = await searchProjectContext("workflow recovery journal", options);
    const second = await searchProjectContext("workflow recovery journal", options);

    expect(first.results[0]?.path).toBe("docs/workflow-recovery.md");
    expect(first.results[0]?.matched_terms).toEqual(
      expect.arrayContaining(["workflow", "recovery", "journal"]),
    );
    expect(first.results[0]?.line_start).toBeGreaterThan(0);
    expect(first.results[0]?.excerpt).toContain("event journal");
    expect(second.results.map((item) => item.path)).toEqual(
      first.results.map((item) => item.path),
    );
    expect(second.results.map((item) => item.score)).toEqual(
      first.results.map((item) => item.score),
    );
  });

  it("excludes obvious secrets and generated directories", async () => {
    await writeProjectFile(".env", "privatecontextsentinel=do-not-index\n");
    await writeProjectFile(".env.local", "privatecontextsentinel=also-do-not-index\n");
    await writeProjectFile("credentials.json", '{"privatecontextsentinel":"secret"}\n');
    await writeProjectFile("id_rsa", "privatecontextsentinel private key material\n");
    await writeProjectFile(
      "node_modules/vendor/README.md",
      "privatecontextsentinel generated dependency\n",
    );
    await writeProjectFile(
      ".aether/runs/private/README.md",
      "privatecontextsentinel local runtime state\n",
    );
    await writeProjectFile("README.md", "A small project with safe documentation.\n");

    const result = await searchProjectContext("privatecontextsentinel", {
      projectRoot: root,
    });

    expect(result.results).toHaveLength(0);
    expect(result.files_scanned).toBe(1);
  });

  it("skips symbolic links and binary content", async () => {
    await writeProjectFile("safe.md", "A safe project context file.\n");
    await writeProjectFile("binary.md", Buffer.from([0, 1, 2, 3, 4]));
    const outside = join(root, "..", basename(root) + "-outside.md");
    await writeFile(outside, "externalcontextsensitiveword\n");
    await symlink(outside, join(root, "linked.md"));

    const result = await searchProjectContext("externalcontextsensitiveword", {
      projectRoot: root,
    });

    expect(result.results).toHaveLength(0);
    expect(result.files_skipped).toBeGreaterThanOrEqual(2);
    await rm(outside, { force: true });
  });

  it("honors nested .gitignore globs, anchored paths, and negations", async () => {
    await writeProjectFile(
      ".gitignore",
      [
        "*.generated.md",
        "!keep.generated.md",
        "/root-only.md",
        "private/",
        "foo/**",
        "\\!literal.md",
        "\\#literal.md",
      ].join("\n"),
    );
    await writeProjectFile("skip.generated.md", "gitignoremarker should be excluded\n");
    await writeProjectFile("keep.generated.md", "gitignoremarker should be included\n");
    await writeProjectFile("root-only.md", "gitignoremarker root anchored file\n");
    await writeProjectFile("nested/root-only.md", "gitignoremarker nested file stays included\n");
    await writeProjectFile("private/hidden.md", "gitignoremarker private directory\n");
    await writeProjectFile("foo/hidden.md", "gitignoremarker double star directory\n");
    await writeProjectFile("!literal.md", "gitignoremarker escaped exclamation\n");
    await writeProjectFile("#literal.md", "gitignoremarker escaped hash\n");
    await writeProjectFile("src/.gitignore", "*.test.ts\n!important.test.ts\n");
    await writeProjectFile("src/skip.test.ts", "gitignoremarker nested ignore rule\n");
    await writeProjectFile("src/important.test.ts", "gitignoremarker nested negation rule\n");
    await writeProjectFile("src/foo/visible.md", "gitignoremarker anchored glob must not match here\n");

    const result = await searchProjectContext("gitignoremarker", {
      projectRoot: root,
      limit: 30,
      maxCharacters: 20_000,
    });
    const paths = new Set(result.results.map((item) => item.path));

    expect(paths.has("keep.generated.md")).toBe(true);
    expect(paths.has("nested/root-only.md")).toBe(true);
    expect(paths.has("!literal.md")).toBe(true);
    expect(paths.has("#literal.md")).toBe(true);
    expect(paths.has("src/important.test.ts")).toBe(true);
    expect(paths.has("src/foo/visible.md")).toBe(true);
    expect(paths.has("skip.generated.md")).toBe(false);
    expect(paths.has("root-only.md")).toBe(false);
    expect(paths.has("private/hidden.md")).toBe(false);
    expect(paths.has("foo/hidden.md")).toBe(false);
    expect(paths.has("src/skip.test.ts")).toBe(false);
  });

  it("enforces a total excerpt character budget", async () => {
    await writeProjectFile(
      "docs/context.md",
      Array.from({ length: 50 }, (_, index) =>
        "contextretrieval workflow ranking source line " + (index + 1),
      ).join("\n"),
    );
    await writeProjectFile(
      "src/context.ts",
      Array.from({ length: 30 }, (_, index) =>
        "contextretrieval workflow source reference " + (index + 1),
      ).join("\n"),
    );

    const result = await searchProjectContext("contextretrieval workflow", {
      projectRoot: root,
      limit: 10,
      maxCharacters: 256,
      maxSnippetLines: 40,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.characters_used).toBeLessThanOrEqual(256);
    expect(result.truncated).toBe(true);
  });

  it("enforces the total bytes read across the project", async () => {
    await writeProjectFile("a-first.md", "totalbudgetcontext first file\n");
    await writeProjectFile("b-second.md", "totalbudgetcontext second file\n");

    const result = await searchProjectContext("totalbudgetcontext", {
      projectRoot: root,
      maxTotalBytes: 34,
    });

    expect(result.files_scanned).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it("skips files over the configured per-file byte limit", async () => {
    await writeProjectFile("large.md", "oversizedcontext ".repeat(50));
    const result = await searchProjectContext("oversizedcontext", {
      projectRoot: root,
      maxFileBytes: 32,
    });

    expect(result.results).toHaveLength(0);
    expect(result.files_skipped).toBe(1);
  });

  it("rejects empty, unsearchable, and oversized queries", async () => {
    await expect(searchProjectContext("  ", { projectRoot: root })).rejects.toThrow(
      ProjectContextSearchError,
    );
    await expect(searchProjectContext("!!!", { projectRoot: root })).rejects.toThrow(
      /searchable word/,
    );
    await expect(searchProjectContext("a".repeat(501), { projectRoot: root })).rejects.toThrow(
      /500 characters/,
    );
  });

  it("rejects invalid retrieval budgets and missing project roots", async () => {
    await expect(searchProjectContext("context", {
      projectRoot: root,
      limit: 0,
    })).rejects.toThrow(/limit must be a positive integer/);
    await expect(searchProjectContext("context", {
      projectRoot: root,
      maxCharacters: 100,
    })).rejects.toThrow(/at least 128/);
    await expect(searchProjectContext("context", {
      projectRoot: join(root, "missing"),
    })).rejects.toThrow(/Project root does not exist/);
  });
});
