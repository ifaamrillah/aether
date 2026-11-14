import {
  lstat,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { parseWorkflowDefinition } from "./workflow-validate.js";

export interface WorkflowFileEntry {
  path: string;
  id: string;
  name: string;
  version: number;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/** Recursively lists and validates workflow YAML files in a directory. */
export async function listWorkflowFiles(
  directory: string,
): Promise<WorkflowFileEntry[]> {
  const requestedRoot = resolve(directory);
  let rootInfo;
  try {
    rootInfo = await lstat(requestedRoot);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("Workflow directory must be a regular directory: " + requestedRoot);
  }

  const root = await realpath(requestedRoot);
  const files: string[] = [];

  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const candidate = resolve(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Workflow directory contains a symbolic link: " + candidate);
      }
      if (entry.isDirectory()) {
        await walk(candidate);
      } else if (entry.isFile() && /[.]ya?ml$/i.test(entry.name)) {
        files.push(candidate);
      }
    }
  };

  await walk(root);
  const results: WorkflowFileEntry[] = [];
  const identifiers = new Set<string>();

  for (const file of files) {
    const actual = await realpath(file);
    const relativePath = relative(root, actual).split(sep).join("/");
    if (relativePath.startsWith("../") || relativePath === "..") {
      throw new Error("Workflow file resolved outside its directory: " + file);
    }

    const parsed = parseWorkflowDefinition(await readFile(actual, "utf8"));
    if (!parsed.ok) {
      throw new Error(
        "Invalid workflow " + relativePath + ": " + parsed.errors.join("; "),
      );
    }
    if (identifiers.has(parsed.definition.id)) {
      throw new Error("Duplicate workflow id in directory: " + parsed.definition.id);
    }
    identifiers.add(parsed.definition.id);

    results.push({
      path: relativePath,
      id: parsed.definition.id,
      name: parsed.definition.name,
      version: parsed.definition.version,
    });
  }

  return results.sort((left, right) => left.path.localeCompare(right.path));
}
