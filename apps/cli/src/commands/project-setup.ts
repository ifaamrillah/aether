import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { validateAetherContract } from "@aether/schemas";
import { createAgentAdapter } from "@aether/adapters";
import type { AdapterId } from "@aether/adapters";
import { validateSkills } from "./skill-validate.js";

export type ProjectMode = "greenfield" | "brownfield";

export interface InitProjectOptions {
  projectRoot: string;
  platforms: AdapterId[];
  mode?: ProjectMode;
  skillsRoot?: string;
  dryRun?: boolean;
  clock?: () => Date;
}

export interface InitProjectResult {
  projectRoot: string;
  skillsRoot: string;
  destinations: string[];
  installed: string[];
  updated: string[];
  unchanged: string[];
  conflicts: Array<{ path: string; reason: string }>;
  config: "created" | "preserved" | "dry-run";
  manifest: "created" | "updated" | "preserved" | "dry-run";
}

interface ManagedFileRecord {
  path: string;
  source: string;
  sha256: string;
}

interface ManagedFilesManifest {
  schema_version: 1;
  managed_by: "aether";
  files: ManagedFileRecord[];
  updated_at: string;
}

interface ProjectConfig {
  schema_version: 1;
  project: {
    id: string;
    name: string;
    mode: ProjectMode;
  };
  platforms: {
    enabled: string[];
  };
  workflow: {
    default: string;
    autonomy: "balanced";
  };
  knowledge: {
    documentation_enabled: true;
    incremental_updates: true;
    codebase_index_enabled: false;
  };
  context: {
    strategy: "progressive";
  };
  security: {
    require_approval_for: string[];
  };
  artifacts: {
    root: string;
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.includes(String.fromCharCode(92)) &&
    !isAbsolute(path) &&
    !/^[A-Za-z]:/.test(path) &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function slugifyProjectId(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

function createProjectConfig(
  projectRoot: string,
  platforms: AdapterId[],
  mode: ProjectMode,
): ProjectConfig {
  const name = basename(projectRoot);
  return {
    schema_version: 1,
    project: {
      id: slugifyProjectId(name),
      name,
      mode,
    },
    platforms: {
      enabled: [...new Set(platforms)],
    },
    workflow: {
      default: "feature-development",
      autonomy: "balanced",
    },
    knowledge: {
      documentation_enabled: true,
      incremental_updates: true,
      codebase_index_enabled: false,
    },
    context: {
      strategy: "progressive",
    },
    security: {
      require_approval_for: [
        "production_deployment",
        "destructive_operation",
        "secret_access",
        "permission_change",
      ],
    },
    artifacts: {
      root: "docs/aether",
    },
  };
}

async function readManagedManifest(
  projectRoot: string,
): Promise<ManagedFilesManifest | undefined> {
  const manifestPath = resolve(projectRoot, ".aether", "managed-files.json");
  let content: string;
  try {
    content = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error(".aether/managed-files.json contains invalid JSON; refusing to modify it.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("schema_version" in parsed) ||
    parsed.schema_version !== 1 ||
    !("managed_by" in parsed) ||
    parsed.managed_by !== "aether" ||
    !("files" in parsed) ||
    !Array.isArray(parsed.files)
  ) {
    throw new Error(".aether/managed-files.json has an unsupported format; refusing to modify it.");
  }

  const files: ManagedFileRecord[] = [];
  for (const item of parsed.files) {
    if (typeof item !== "object" || item === null) {
      throw new Error(".aether/managed-files.json contains an invalid file record.");
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.path !== "string" ||
      !safeRelativePath(record.path) ||
      typeof record.source !== "string" ||
      typeof record.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    ) {
      throw new Error(".aether/managed-files.json contains an invalid file record.");
    }
    files.push({
      path: record.path,
      source: record.source,
      sha256: record.sha256,
    });
  }

  const updatedAt =
    "updated_at" in parsed && typeof parsed.updated_at === "string"
      ? parsed.updated_at
      : "";
  return {
    schema_version: 1,
    managed_by: "aether",
    files,
    updated_at: updatedAt,
  };
}

async function atomicWrite(
  projectRoot: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!safeRelativePath(relativePath)) {
    throw new Error("Unsafe project-relative path: " + relativePath);
  }

  const destination = resolve(projectRoot, ...relativePath.split("/"));
  if (!isWithinRoot(projectRoot, destination)) {
    throw new Error("Destination escaped the project root: " + relativePath);
  }

  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  if (!isWithinRoot(projectRoot, realParent)) {
    throw new Error("Destination parent resolves outside the project root: " + relativePath);
  }

  const temporary = resolve(realParent, "." + basename(destination) + "." + randomUUID() + ".tmp");
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function listRegularFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error("Skill bundles must not contain symbolic links: " + join(current, entry.name));
      }
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        files.push(child);
      } else {
        throw new Error("Unsupported filesystem entry in skill bundle: " + child);
      }
    }
  };
  await walk(directory);
  return files.sort();
}

async function resolveSkillBundle(
  skillsRoot: string,
): Promise<Array<{ name: string; sourceDirectory: string; files: string[] }>> {
  const root = await realpath(resolve(skillsRoot));
  const validations = await validateSkills(root);
  const invalid = validations.filter((result) => !result.valid);
  if (invalid.length > 0) {
    throw new Error(
      "Aether skill bundle contains invalid skills:\n" +
        invalid.map((result) => "- " + result.path + ": " + result.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.message).join("; ")).join("\n"),
    );
  }

  const bundle: Array<{ name: string; sourceDirectory: string; files: string[] }> = [];
  for (const validation of validations) {
    if (!validation.name) throw new Error("Validated skill is missing its name: " + validation.path);
    const skillFile = resolve(root, ...validation.path.split("/"));
    const sourceDirectory = dirname(skillFile);
    const realDirectory = await realpath(sourceDirectory);
    if (!isWithinRoot(root, realDirectory)) {
      throw new Error("Skill directory resolves outside the bundle root: " + validation.path);
    }
    const files = await listRegularFiles(realDirectory);
    if (!files.some((file) => basename(file) === "SKILL.md")) {
      throw new Error("Skill folder is missing SKILL.md: " + validation.path);
    }
    bundle.push({
      name: validation.name,
      sourceDirectory: realDirectory,
      files,
    });
  }
  return bundle;
}

export async function resolveBundledSkillsRoot(): Promise<string> {
  const environmentPath = process.env.AETHER_SKILLS_DIR;
  if (environmentPath) return realpath(resolve(environmentPath));

  const bundledPath = fileURLToPath(new URL("../../../../skills/", import.meta.url));
  try {
    return await realpath(bundledPath);
  } catch {
    throw new Error(
      "Aether skill bundle was not found. Set AETHER_SKILLS_DIR or pass --skills <path>.",
    );
  }
}

export async function initProject(
  options: InitProjectOptions,
): Promise<InitProjectResult> {
  const projectRoot = await realpath(resolve(options.projectRoot));
  const platforms = [...new Set(options.platforms)];
  if (platforms.length === 0) throw new Error("Select at least one Aether installation platform.");

  const mode = options.mode ?? "brownfield";
  const skillsRoot = await realpath(resolve(options.skillsRoot ?? await resolveBundledSkillsRoot()));
  const skillBundle = await resolveSkillBundle(skillsRoot);
  const destinations = [...new Set(
    platforms.map((platform) => createAgentAdapter(platform).descriptor.skill_install_path),
  )];

  const result: InitProjectResult = {
    projectRoot,
    skillsRoot,
    destinations,
    installed: [],
    updated: [],
    unchanged: [],
    conflicts: [],
    config: options.dryRun ? "dry-run" : "preserved",
    manifest: options.dryRun ? "dry-run" : "preserved",
  };

  const configRelativePath = ".aether/config.yaml";
  const configAbsolutePath = resolve(projectRoot, configRelativePath);
  const configExists = await lstat(configAbsolutePath).then(() => true).catch(() => false);
  if (!configExists) {
    const config = createProjectConfig(projectRoot, platforms, mode);
    const validation = validateAetherContract("project-config", config);
    if (!validation.valid) {
      throw new Error(
        "Generated project configuration is invalid:\n" +
          validation.errors.map((issue) => "- " + issue.path + ": " + issue.message).join("\n"),
      );
    }
    if (!options.dryRun) {
      await atomicWrite(projectRoot, configRelativePath, Buffer.from(stringify(config), "utf8"));
    }
    result.config = options.dryRun ? "dry-run" : "created";
  }

  const previousManifest = await readManagedManifest(projectRoot);
  const managedByPath = new Map(
    (previousManifest?.files ?? []).map((record) => [record.path, record] as const),
  );
  const nextManaged = new Map(managedByPath);
  const plannedWrites: Array<{
    path: string;
    bytes: Buffer;
    source: string;
    action: "installed" | "updated" | "unchanged";
  }> = [];

  for (const destination of destinations) {
    for (const skill of skillBundle) {
      const conflicts: Array<{ path: string; reason: string }> = [];
      const candidates: Array<{
        path: string;
        bytes: Buffer;
        source: string;
        action: "installed" | "updated" | "unchanged";
      }> = [];

      for (const sourceFile of skill.files) {
        const sourceRelative = relative(skill.sourceDirectory, sourceFile).split(sep).join("/");
        const destinationRelative = destination + "/" + skill.name + "/" + sourceRelative;
        if (!safeRelativePath(destinationRelative)) {
          throw new Error("Unsafe skill destination: " + destinationRelative);
        }

        const sourceBytes = await readFile(sourceFile);
        const sourceHash = sha256(sourceBytes);
        const managedRecord = managedByPath.get(destinationRelative);
        const destinationAbsolute = resolve(projectRoot, ...destinationRelative.split("/"));
        const destinationEntry = await lstat(destinationAbsolute).catch(() => undefined);

        if (!destinationEntry) {
          candidates.push({
            path: destinationRelative,
            bytes: sourceBytes,
            source: relative(skillsRoot, sourceFile).split(sep).join("/"),
            action: "installed",
          });
          continue;
        }

        if (!destinationEntry.isFile()) {
          conflicts.push({
            path: destinationRelative,
            reason: "Existing destination is not a regular file; it was not changed.",
          });
          continue;
        }

        if (!managedRecord) {
          conflicts.push({
            path: destinationRelative,
            reason: "File already exists and is not recorded as Aether-managed; it was preserved.",
          });
          continue;
        }

        const realDestination = await realpath(destinationAbsolute);
        if (!isWithinRoot(projectRoot, realDestination)) {
          conflicts.push({
            path: destinationRelative,
            reason: "Existing destination resolves outside the project; it was preserved.",
          });
          continue;
        }

        const existingBytes = await readFile(realDestination);
        const existingHash = sha256(existingBytes);
        if (existingHash !== managedRecord.sha256) {
          conflicts.push({
            path: destinationRelative,
            reason: "Aether-managed file was modified by a user; it was preserved.",
          });
          continue;
        }

        if (existingHash === sourceHash) {
          candidates.push({
            path: destinationRelative,
            bytes: sourceBytes,
            source: relative(skillsRoot, sourceFile).split(sep).join("/"),
            action: "unchanged",
          });
        } else {
          candidates.push({
            path: destinationRelative,
            bytes: sourceBytes,
            source: relative(skillsRoot, sourceFile).split(sep).join("/"),
            action: "updated",
          });
        }
      }

      if (conflicts.length > 0) {
        result.conflicts.push(...conflicts);
        continue;
      }

      plannedWrites.push(...candidates);
    }
  }

  if (options.dryRun) {
    for (const item of plannedWrites) result[item.action].push(item.path);
    return result;
  }

  for (const item of plannedWrites) {
    if (item.action === "installed" || item.action === "updated") {
      await atomicWrite(projectRoot, item.path, item.bytes);
    }
    nextManaged.set(item.path, {
      path: item.path,
      source: item.source,
      sha256: sha256(item.bytes),
    });
    result[item.action].push(item.path);
  }

  const files = [...nextManaged.values()].sort((a, b) => a.path.localeCompare(b.path));
  const timestamp = (options.clock ?? (() => new Date()))();
  if (!Number.isFinite(timestamp.getTime())) throw new Error("Init clock returned an invalid timestamp.");
  const manifest: ManagedFilesManifest = {
    schema_version: 1,
    managed_by: "aether",
    files,
    updated_at: timestamp.toISOString(),
  };
  const manifestRelativePath = ".aether/managed-files.json";
  const previousManifestText = previousManifest
    ? JSON.stringify(previousManifest)
    : "";
  const nextManifestText = JSON.stringify(manifest);
  if (previousManifestText !== nextManifestText || !previousManifest) {
    await atomicWrite(
      projectRoot,
      manifestRelativePath,
      Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"),
    );
    result.manifest = previousManifest ? "updated" : "created";
  }

  return result;
}

export interface DoctorCheck {
  status: "pass" | "warning" | "fail";
  name: string;
  message: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  passed: number;
  warnings: number;
  failed: number;
}

export async function doctorProject(projectRoot: string): Promise<DoctorResult> {
  const root = await realpath(resolve(projectRoot));
  const checks: DoctorCheck[] = [];
  const add = (status: DoctorCheck["status"], name: string, message: string): void => {
    checks.push({ status, name, message });
  };

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  add(
    nodeMajor >= 22 ? "pass" : "fail",
    "node",
    nodeMajor >= 22
      ? "Node.js " + process.versions.node + " satisfies the >=22 runtime requirement."
      : "Node.js " + process.versions.node + " is too old; Aether requires Node.js 22 or newer.",
  );

  const configPath = resolve(root, ".aether", "config.yaml");
  try {
    const configText = await readFile(configPath, "utf8");
    const config = parse(configText, { prettyErrors: true, uniqueKeys: true });
    const validation = validateAetherContract("project-config", config);
    if (validation.valid) {
      add("pass", "project-config", ".aether/config.yaml is valid.");
    } else {
      add(
        "fail",
        "project-config",
        validation.errors.map((issue) => issue.path + ": " + issue.message).join("; "),
      );
    }
  } catch (error) {
    add(
      "warning",
      "project-config",
      error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "Aether is not initialized in this project. Run aether init."
        : "Unable to read or parse .aether/config.yaml: " +
          (error instanceof Error ? error.message : "unknown error"),
    );
  }

  const manifestPath = resolve(root, ".aether", "managed-files.json");
  try {
    const manifestText = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(manifestText) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("schema_version" in parsed) ||
      parsed.schema_version !== 1 ||
      !("managed_by" in parsed) ||
      parsed.managed_by !== "aether" ||
      !("files" in parsed) ||
      !Array.isArray(parsed.files)
    ) {
      add("fail", "managed-files", "Managed file manifest has an unsupported format.");
    } else {
      add("pass", "managed-files", "Managed file manifest format is valid.");
      for (const item of parsed.files) {
        if (typeof item !== "object" || item === null) {
          add("fail", "managed-file-entry", "Managed file manifest contains an invalid record.");
          continue;
        }
        const record = item as Record<string, unknown>;
        if (
          typeof record.path !== "string" ||
          !safeRelativePath(record.path) ||
          typeof record.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(record.sha256)
        ) {
          add("fail", "managed-file-entry", "Managed file manifest contains an invalid path or checksum.");
          continue;
        }
        const filePath = resolve(root, ...record.path.split("/"));
        try {
          const realFilePath = await realpath(filePath);
          if (!isWithinRoot(root, realFilePath)) {
            add("fail", "managed-file:" + record.path, "Managed file resolves outside the project root.");
            continue;
          }
          const details = await stat(realFilePath);
          if (!details.isFile()) {
            add("fail", "managed-file:" + record.path, "Managed path is not a regular file.");
            continue;
          }
          const actualHash = sha256(await readFile(realFilePath));
          if (actualHash !== record.sha256) {
            add("warning", "managed-file:" + record.path, "File was modified after Aether installed it.");
          } else {
            add("pass", "managed-file:" + record.path, "Managed file checksum is unchanged.");
          }
        } catch {
          add("warning", "managed-file:" + record.path, "Managed file is missing.");
        }
      }
    }
  } catch (error) {
    add(
      error instanceof Error && "code" in error && error.code === "ENOENT" ? "warning" : "fail",
      "managed-files",
      error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "No Aether managed-file manifest found; run aether init."
        : "Unable to read managed-file manifest: " +
          (error instanceof Error ? error.message : "unknown error"),
    );
  }

  return {
    checks,
    passed: checks.filter((check) => check.status === "pass").length,
    warnings: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "fail").length,
  };
}
 

export async function updateProject(options: {
  projectRoot: string;
  skillsRoot?: string;
  dryRun?: boolean;
  clock?: () => Date;
}): Promise<InitProjectResult> {
  const root = await realpath(resolve(options.projectRoot));
  const configPath = resolve(root, ".aether", "config.yaml");
  const content = await readFile(configPath, "utf8").catch((error: unknown) => {
    throw new Error(
      error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "Aether is not initialized here. Run aether init first."
        : "Unable to read .aether/config.yaml.",
    );
  });

  let parsed: unknown;
  try {
    parsed = parse(content, { prettyErrors: true, uniqueKeys: true });
  } catch (error) {
    throw new Error(
      "Project configuration is invalid YAML: " +
        (error instanceof Error ? error.message : "unknown parse error"),
    );
  }

  const validation = validateAetherContract("project-config", parsed);
  if (!validation.valid) {
    throw new Error(
      "Project configuration is invalid:\n" +
        validation.errors.map((issue) => "- " + issue.path + ": " + issue.message).join("\n"),
    );
  }

  const config = parsed as ProjectConfig;
  const knownPlatforms = new Set<AdapterId>([
    "generic",
    "claude-code",
    "codex",
    "opencode",
    "gemini-cli",
    "antigravity",
  ]);
  const platforms = config.platforms.enabled.filter(
    (platform): platform is AdapterId => knownPlatforms.has(platform as AdapterId),
  );
  if (platforms.length !== config.platforms.enabled.length || platforms.length === 0) {
    throw new Error(
      "Project config contains an unsupported or empty platform list. Update platforms.enabled before running aether update.",
    );
  }

  return initProject({
    projectRoot: root,
    ...(options.skillsRoot === undefined ? {} : { skillsRoot: options.skillsRoot }),
    platforms,
    mode: config.project.mode,
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
}

export interface UninstallProjectResult {
  removed: string[];
  alreadyMissing: string[];
  preserved: Array<{ path: string; reason: string }>;
  manifestRemoved: boolean;
}

/**
 * Removes only files recorded by Aether whose current checksum still matches
 * the managed manifest. User-modified and untracked files are never deleted.
 * Project configuration is preserved.
 */
export async function uninstallProject(
  projectRoot: string,
): Promise<UninstallProjectResult> {
  const root = await realpath(resolve(projectRoot));
  const manifest = await readManagedManifest(root);
  const result: UninstallProjectResult = {
    removed: [],
    alreadyMissing: [],
    preserved: [],
    manifestRemoved: false,
  };

  if (!manifest) return result;

  const remaining: ManagedFileRecord[] = [];
  for (const record of manifest.files) {
    const absolute = resolve(root, ...record.path.split("/"));
    if (!isWithinRoot(root, absolute)) {
      result.preserved.push({
        path: record.path,
        reason: "Managed path escaped the project root.",
      });
      remaining.push(record);
      continue;
    }

    const entry = await lstat(absolute).catch(() => undefined);
    if (!entry) {
      result.alreadyMissing.push(record.path);
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      result.preserved.push({
        path: record.path,
        reason: "Path is no longer a regular file; it was preserved.",
      });
      remaining.push(record);
      continue;
    }

    const actualPath = await realpath(absolute);
    if (!isWithinRoot(root, actualPath)) {
      result.preserved.push({
        path: record.path,
        reason: "Path resolves outside the project root; it was preserved.",
      });
      remaining.push(record);
      continue;
    }

    const currentHash = sha256(await readFile(actualPath));
    if (currentHash !== record.sha256) {
      result.preserved.push({
        path: record.path,
        reason: "File was modified after Aether installed it; it was preserved.",
      });
      remaining.push(record);
      continue;
    }

    await rm(actualPath);
    result.removed.push(record.path);
  }

  const manifestPath = resolve(root, ".aether", "managed-files.json");
  if (remaining.length === 0) {
    await rm(manifestPath, { force: true });
    result.manifestRemoved = true;
  } else {
    const nextManifest: ManagedFilesManifest = {
      ...manifest,
      files: remaining,
      updated_at: new Date().toISOString(),
    };
    await atomicWrite(
      root,
      ".aether/managed-files.json",
      Buffer.from(JSON.stringify(nextManifest, null, 2) + "\n", "utf8"),
    );
  }

  return result;
}
