import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { parse } from "yaml";

export interface SkillValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface SkillFileValidation {
  path: string;
  name?: string;
  valid: boolean;
  issues: SkillValidationIssue[];
}

const ALLOWED_FRONTMATTER_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validateSkillContent(
  content: string,
  expectedDirectoryName: string,
  displayPath = "SKILL.md",
): SkillFileValidation {
  const issues: SkillValidationIssue[] = [];
  const add = (
    severity: SkillValidationIssue["severity"],
    code: string,
    message: string,
  ): void => issues.push({ severity, code, message });

  if (content.startsWith("\uFEFF")) {
    add("error", "frontmatter_bom", "SKILL.md must not begin with a byte-order mark.");
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    add("error", "frontmatter_missing", "YAML frontmatter must start at the first line with ---.");
    return {
      path: displayPath,
      valid: false,
      issues,
    };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex < 0) {
    add("error", "frontmatter_unclosed", "YAML frontmatter is missing its closing --- delimiter.");
    return {
      path: displayPath,
      valid: false,
      issues,
    };
  }

  let metadata: unknown;
  try {
    metadata = parse(lines.slice(1, closingIndex).join("\n"), {
      prettyErrors: true,
      uniqueKeys: true,
    });
  } catch (error) {
    add(
      "error",
      "frontmatter_yaml",
      error instanceof Error ? error.message : "Unable to parse YAML frontmatter.",
    );
    return {
      path: displayPath,
      valid: false,
      issues,
    };
  }

  if (!isPlainObject(metadata)) {
    add("error", "frontmatter_object", "Frontmatter must be a YAML mapping.");
    return {
      path: displayPath,
      valid: false,
      issues,
    };
  }

  for (const field of Object.keys(metadata)) {
    if (!ALLOWED_FRONTMATTER_FIELDS.has(field)) {
      add(
        "error",
        "unsupported_frontmatter_field",
        'Unsupported top-level frontmatter field "' + field +
          '". Put Aether-specific fields under metadata.',
      );
    }
  }

  const name = metadata.name;
  if (typeof name !== "string") {
    add("error", "name_required", "Frontmatter field name must be a string.");
  } else {
    if (name.length < 1 || name.length > 64) {
      add("error", "name_length", "Skill name must contain 1 to 64 characters.");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      add(
        "error",
        "name_format",
        "Skill name must use lowercase letters, numbers, and single hyphen separators.",
      );
    }
    if (name !== expectedDirectoryName) {
      add(
        "error",
        "name_directory_mismatch",
        'Skill name "' + name + '" must match directory "' + expectedDirectoryName + '".',
      );
    }
  }

  const description = metadata.description;
  if (typeof description !== "string" || description.trim().length === 0) {
    add("error", "description_required", "Description must be a non-empty string.");
  } else if (description.length > 1024) {
    add("error", "description_length", "Description must not exceed 1,024 characters.");
  }

  if (metadata.license !== undefined && typeof metadata.license !== "string") {
    add("error", "license_type", "Optional license field must be a string.");
  }

  if (metadata.compatibility !== undefined) {
    if (
      typeof metadata.compatibility !== "string" ||
      metadata.compatibility.length < 1 ||
      metadata.compatibility.length > 500
    ) {
      add("error", "compatibility_length", "Compatibility must be a string of 1 to 500 characters.");
    }
  }

  if (metadata["allowed-tools"] !== undefined && typeof metadata["allowed-tools"] !== "string") {
    add("error", "allowed_tools_type", "Experimental allowed-tools field must be a space-delimited string.");
  }

  if (metadata.metadata !== undefined) {
    if (!isPlainObject(metadata.metadata)) {
      add("error", "metadata_type", "metadata must be a mapping of string keys to string values.");
    } else {
      for (const [key, value] of Object.entries(metadata.metadata)) {
        if (key.trim().length === 0 || typeof value !== "string") {
          add("error", "metadata_value_type", "Every metadata entry must have a non-empty key and string value.");
        }
      }
    }
  }

  const body = lines.slice(closingIndex + 1).join("\n").trim();
  if (body.length === 0) {
    add("error", "body_empty", "Skill instructions after the frontmatter must not be empty.");
  } else {
    const bodyLines = body.split("\n").length;
    if (bodyLines > 500) {
      add(
        "warning",
        "body_too_long",
        "SKILL.md exceeds 500 lines; move detailed material into references/ for progressive disclosure.",
      );
    }
    if (!/^#{1,6}\s/m.test(body)) {
      add("warning", "body_without_heading", "Use Markdown headings to make skill instructions easy to scan.");
    }
  }

  return {
    path: displayPath,
    ...(typeof name === "string" ? { name } : {}),
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".aether",
  "node_modules",
  "dist",
  "coverage",
]);

async function findSkillFiles(targetPath: string): Promise<string[]> {
  const absolute = resolve(targetPath);
  const details = await stat(absolute);

  if (details.isFile()) {
    if (basename(absolute) !== "SKILL.md") {
      throw new Error("A skill file target must be named SKILL.md.");
    }
    return [absolute];
  }

  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(child);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        found.push(child);
      }
    }
  };

  await walk(absolute);
  return found.sort();
}

export async function validateSkills(
  targetPath: string,
): Promise<SkillFileValidation[]> {
  const absoluteTarget = resolve(targetPath);
  const files = await findSkillFiles(absoluteTarget);
  const targetIsFile = (await stat(absoluteTarget)).isFile();

  if (files.length === 0) {
    throw new Error("No SKILL.md files were found at " + absoluteTarget + ".");
  }

  const results: SkillFileValidation[] = [];
  for (const file of files) {
    const directoryName = basename(resolve(file, ".."));
    const displayPath = targetIsFile
      ? file
      : relative(absoluteTarget, file).split("\\").join("/");
    const content = await readFile(file, "utf8");
    results.push(validateSkillContent(content, directoryName, displayPath));
  }
  return results;
}
