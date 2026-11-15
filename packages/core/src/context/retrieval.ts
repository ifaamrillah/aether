import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

export interface ProjectContextSearchOptions {
  projectRoot: string;
  limit?: number;
  maxCharacters?: number;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxSnippetLines?: number;
}

export interface ProjectContextSnippet {
  path: string;
  line_start: number;
  line_end: number;
  score: number;
  matched_terms: string[];
  excerpt: string;
}

export interface ProjectContextSearchResult {
  query: string;
  files_scanned: number;
  files_skipped: number;
  truncated: boolean;
  characters_used: number;
  results: ProjectContextSnippet[];
}

export class ProjectContextSearchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectContextSearchError";
  }
}

interface SearchDocument {
  path: string;
  content: string;
  lines: string[];
  length: number;
  term_frequency: Map<string, number>;
  path_terms: Set<string>;
}

interface RankedDocument {
  document: SearchDocument;
  score: number;
  matched_terms: string[];
  snippet_start: number;
}

const IGNORED_DIRECTORIES = new Set([
  ".aether", ".aws", ".azure", ".git", ".gradle", ".gnupg", ".kube",
  ".mypy_cache", ".next", ".nuxt", ".pytest_cache", ".ssh", ".terraform",
  ".turbo", ".venv", "__pycache__", "build", "coverage", "dist",
  "node_modules", "out", "target", "temp", "tmp", "vendor", "venv",
]);

const ALLOWED_HIDDEN_DIRECTORIES = new Set([
  ".agents", ".changeset", ".claude", ".codex", ".devcontainer",
  ".github", ".gemini", ".husky", ".vscode",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".adoc", ".bash", ".c", ".cc", ".cpp", ".cs", ".css", ".cjs",
  ".go", ".graphql", ".gql", ".gradle", ".h", ".hpp", ".htm",
  ".html", ".ini", ".java", ".js", ".json", ".jsonc", ".jsx",
  ".kt", ".kts", ".less", ".md", ".mdx", ".mjs", ".php",
  ".properties", ".py", ".rb", ".rs", ".rst", ".scss", ".sh",
  ".sql", ".svelte", ".swift", ".tf", ".toml", ".ts", ".tsx",
  ".txt", ".vue", ".xml", ".yaml", ".yml",
]);

const ALLOWED_FILENAMES = new Set([
  ".editorconfig", ".env.example", ".gitignore", ".nvmrc", "AGENTS.md",
  "CMakeLists.txt", "CODE_OF_CONDUCT", "CONTRIBUTING", "Dockerfile",
  "Gemfile", "Justfile", "LICENSE", "Makefile", "NOTICE", "Procfile",
  "README", "SECURITY", "Taskfile",
]);

const SENSITIVE_FILENAMES = new Set([
  "credentials", "credentials.json", "id_dsa", "id_ecdsa", "id_ed25519",
  "id_rsa", "oauth-token.json", "secrets", "secrets.json",
  "service-account.json",
]);

const IGNORED_FILENAMES = new Set([
  "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
  ".npmrc", ".pypirc",
]);

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been",
  "before", "being", "between", "but", "can", "could", "does", "doing",
  "for", "from", "has", "have", "here", "how", "into", "its", "just",
  "more", "most", "not", "only", "other", "our", "out", "over", "should",
  "some", "such", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "those", "through", "under", "use", "used",
  "using", "was", "what", "when", "where", "which", "while", "who",
  "with", "would", "yang", "dan", "atau", "dari", "dengan", "di", "ini",
  "itu", "ke", "pada", "untuk",
]);

const DEFAULTS = {
  limit: 8,
  maxCharacters: 12_000,
  maxFiles: 2_000,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxSnippetLines: 12,
} as const;

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
}

function isWithinRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (
    !path.startsWith(".." + sep) &&
    path !== ".." &&
    !isAbsolute(path)
  );
}

function isSensitiveFile(name: string): boolean {
  const normalized = name.toLowerCase();
  if (normalized === ".env.example") return false;
  if (normalized === ".env" || normalized.startsWith(".env.")) return true;
  if (SENSITIVE_FILENAMES.has(normalized)) return true;
  return /\.(?:crt|der|jks|key|keystore|p12|pfx|pem)$/i.test(normalized);
}

function isCandidateTextFile(name: string): boolean {
  if (isSensitiveFile(name) || IGNORED_FILENAMES.has(name.toLowerCase())) {
    return false;
  }
  return ALLOWED_FILENAMES.has(name) || ALLOWED_EXTENSIONS.has(extname(name).toLowerCase());
}

function validatePositiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
  maximum: number,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    throw new ProjectContextSearchError(
      label + " must be a positive integer no greater than " + maximum + ".",
    );
  }
  return selected;
}

interface IgnoreRule {
  base_path: string;
  pattern: RegExp;
  negated: boolean;
  directory_only: boolean;
}

function escapeRegexCharacter(character: string): string {
  return /[|\\{}()[\]^$+?.]/.test(character) ? "\\" + character : character;
}

function compileGitIgnoreGlob(pattern: string, anchored: boolean): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "\\") {
      const next = pattern[index + 1];
      if (next !== undefined) {
        source += escapeRegexCharacter(next);
        index += 1;
      } else {
        source += "\\\\";
      }
      continue;
    }
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        while (pattern[index + 1] === "*") index += 1;
        if (pattern[index + 1] === "/") {
          source += "(?:.*/)?";
          index += 1;
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    if (character === "[") {
      const closing = pattern.indexOf("]", index + 1);
      if (closing > index + 1) {
        let characterClass = pattern.slice(index + 1, closing);
        if (characterClass.startsWith("!")) {
          characterClass = "^" + characterClass.slice(1);
        }
        source += "[" + characterClass + "]";
        index = closing;
      } else {
        source += "\\[";
      }
      continue;
    }
    source += escapeRegexCharacter(character);
  }

  const prefix = anchored ? "^" : "(?:^|/)";
  return new RegExp(prefix + source + "(?:/.*)?$");
}

function trimGitIgnoreTrailingSpaces(value: string): string {
  let line = value;
  while (line.endsWith(" ")) {
    let backslashes = 0;
    for (let index = line.length - 2; index >= 0 && line[index] === "\\"; index -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 1) {
      line = line.slice(0, -2) + " ";
      break;
    }
    line = line.slice(0, -1);
  }
  return line;
}

function parseGitIgnoreRules(content: string, basePath: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    let line = trimGitIgnoreTrailingSpaces(rawLine);
    if (line.length === 0) continue;

    const escapedLeadingCharacter = line.startsWith("\\#") || line.startsWith("\\!");
    if (escapedLeadingCharacter) {
      line = line.slice(1);
    } else if (line.startsWith("#")) {
      continue;
    }

    let negated = false;
    if (!escapedLeadingCharacter && line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    if (line.length === 0) continue;

    const anchored = line.startsWith("/");
    if (anchored) line = line.slice(1);
    const directoryOnly = line.endsWith("/");
    if (directoryOnly) line = line.slice(0, -1);
    if (line.length === 0) continue;

    const hasSlash = line.includes("/");
    const endsWithDirectoryGlob = line.endsWith("/**");
    if (endsWithDirectoryGlob) {
      line = line.slice(0, -3);
      if (line.length === 0) line = "**";
    }

    rules.push({
      base_path: basePath,
      pattern: compileGitIgnoreGlob(line, anchored || hasSlash),
      negated,
      directory_only: directoryOnly,
    });
  }
  return rules;
}

async function readGitIgnoreRules(
  absoluteDirectory: string,
  relativeDirectory: string,
  maxFileBytes: number,
): Promise<IgnoreRule[]> {
  const ignorePath = resolve(absoluteDirectory, ".gitignore");
  try {
    const details = await lstat(ignorePath);
    if (!details.isFile() || details.isSymbolicLink() || details.size > maxFileBytes) {
      return [];
    }
    const buffer = await readFile(ignorePath);
    if (buffer.byteLength > maxFileBytes || buffer.includes(0)) return [];
    return parseGitIgnoreRules(buffer.toString("utf8"), relativeDirectory);
  } catch {
    return [];
  }
}

function pathIsIgnored(
  relativePath: string,
  isDirectory: boolean,
  rules: IgnoreRule[],
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directory_only && !isDirectory) continue;

    let candidate = relativePath;
    if (rule.base_path.length > 0) {
      const prefix = rule.base_path + "/";
      if (!candidate.startsWith(prefix)) continue;
      candidate = candidate.slice(prefix.length);
    }
    if (rule.pattern.test(candidate)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

async function collectDocuments(
  root: string,
  options: {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    markdownOnly?: boolean;
  },
): Promise<{
  documents: SearchDocument[];
  filesSkipped: number;
  truncated: boolean;
}> {
  const documents: SearchDocument[] = [];
  let filesSkipped = 0;
  let totalBytes = 0;
  let truncated = false;

  async function visit(relativeDirectory: string, inheritedRules: IgnoreRule[]): Promise<void> {
    if (documents.length >= options.maxFiles || totalBytes >= options.maxTotalBytes) {
      truncated = true;
      return;
    }

    const absoluteDirectory = relativeDirectory
      ? resolve(root, ...relativeDirectory.split("/"))
      : root;
    let entries;
    try {
      const directoryDetails = await lstat(absoluteDirectory);
      if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink()) {
        filesSkipped += 1;
        return;
      }
      const realDirectory = await realpath(absoluteDirectory);
      if (!isWithinRoot(root, realDirectory)) {
        filesSkipped += 1;
        return;
      }
      entries = await readdir(realDirectory, { withFileTypes: true });
    } catch {
      filesSkipped += 1;
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    const localRules = await readGitIgnoreRules(
      absoluteDirectory,
      relativeDirectory,
      options.maxFileBytes,
    );
    const rules = [...inheritedRules, ...localRules];

    for (const entry of entries) {
      if (documents.length >= options.maxFiles || totalBytes >= options.maxTotalBytes) {
        truncated = true;
        return;
      }

      const relativePath = relativeDirectory
        ? relativeDirectory + "/" + entry.name
        : entry.name;

      if (entry.isSymbolicLink()) {
        filesSkipped += 1;
        continue;
      }

      if (entry.isDirectory()) {
        const name = entry.name.toLowerCase();
        if (
          IGNORED_DIRECTORIES.has(name) ||
          (name.startsWith(".") && !ALLOWED_HIDDEN_DIRECTORIES.has(name))
        ) {
          continue;
        }
        if (pathIsIgnored(relativePath, true, rules)) {
          filesSkipped += 1;
          continue;
        }
        await visit(relativePath, rules);
        continue;
      }

      if (!entry.isFile() || !isCandidateTextFile(entry.name)) {
        continue;
      }
      if (
        options.markdownOnly &&
        ![".md", ".mdx"].includes(extname(entry.name).toLowerCase())
      ) {
        continue;
      }
      if (pathIsIgnored(relativePath, false, rules)) {
        filesSkipped += 1;
        continue;
      }

      try {
        const absolutePath = resolve(root, ...relativePath.split("/"));
        const details = await lstat(absolutePath);
        if (!details.isFile() || details.isSymbolicLink()) {
          filesSkipped += 1;
          continue;
        }
        if (details.size > options.maxFileBytes) {
          filesSkipped += 1;
          continue;
        }
        if (totalBytes + details.size > options.maxTotalBytes) {
          truncated = true;
          return;
        }

        const realPath = await realpath(absolutePath);
        if (!isWithinRoot(root, realPath)) {
          filesSkipped += 1;
          continue;
        }

        const buffer = await readFile(realPath);
        if (buffer.byteLength > options.maxFileBytes || buffer.includes(0)) {
          filesSkipped += 1;
          continue;
        }
        if (totalBytes + buffer.byteLength > options.maxTotalBytes) {
          truncated = true;
          return;
        }
        const content = buffer.toString("utf8");
        const replacementCount = (content.match(/\uFFFD/g) ?? []).length;
        if (replacementCount > Math.max(3, Math.floor(content.length * 0.005))) {
          filesSkipped += 1;
          continue;
        }

        const terms = tokenize(content);
        const termFrequency = new Map<string, number>();
        for (const term of terms) {
          termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
        }

        documents.push({
          path: relativePath,
          content,
          lines: content.split(/\r?\n/),
          length: terms.length,
          term_frequency: termFrequency,
          path_terms: new Set(tokenize(relativePath)),
        });
        totalBytes += buffer.byteLength;
      } catch {
        filesSkipped += 1;
      }
    }
  }

  await visit("", []);
  return { documents, filesSkipped, truncated };
}

function rankDocuments(
  documents: SearchDocument[],
  terms: string[],
  phrase: string,
): RankedDocument[] {
  const documentFrequency = new Map<string, number>();
  for (const term of terms) {
    documentFrequency.set(
      term,
      documents.reduce(
        (count, document) => count + (document.term_frequency.has(term) ? 1 : 0),
        0,
      ),
    );
  }

  const averageLength = documents.length > 0
    ? Math.max(1, documents.reduce((sum, document) => sum + document.length, 0) / documents.length)
    : 1;
  const k1 = 1.2;
  const b = 0.75;

  const ranked: RankedDocument[] = [];
  for (const document of documents) {
    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of terms) {
      const frequency = document.term_frequency.get(term) ?? 0;
      const documentCount = documentFrequency.get(term) ?? 0;
      const inverseFrequency = Math.log(
        1 + (documents.length - documentCount + 0.5) / (documentCount + 0.5),
      );

      if (frequency > 0) {
        score += inverseFrequency *
          (frequency * (k1 + 1)) /
          (frequency + k1 * (1 - b + b * document.length / averageLength));
        matchedTerms.push(term);
      }
      if (document.path_terms.has(term)) {
        score += 1.5 + inverseFrequency * 0.5;
        if (!matchedTerms.includes(term)) matchedTerms.push(term);
      }
    }

    if (phrase.length >= 3 && document.content.toLowerCase().includes(phrase)) {
      score += 2.5;
    }
    if (score <= 0) continue;

    const lineScores = document.lines.map((line) => {
      const lineTerms = new Set(tokenize(line));
      return terms.reduce(
        (sum, term) => sum + (lineTerms.has(term) ? 1 : 0),
        0,
      );
    });
    let bestLine = lineScores.findIndex((value) => value > 0);
    if (bestLine < 0) bestLine = 0;

    ranked.push({
      document,
      score,
      matched_terms: matchedTerms.sort(),
      snippet_start: bestLine,
    });
  }

  return ranked.sort((left, right) =>
    right.score - left.score ||
    left.document.path.localeCompare(right.document.path, "en"),
  );
}

function createExcerpt(
  document: SearchDocument,
  centerLine: number,
  maxLines: number,
): { start: number; end: number; text: string } {
  const start = Math.max(0, Math.min(
    document.lines.length - 1,
    centerLine - Math.floor((maxLines - 1) / 2),
  ));
  const end = Math.min(document.lines.length, start + maxLines);
  const excerpt = document.lines
    .slice(start, end)
    .map((line, index) => {
      const normalizedLine = line.length > 800
        ? line.slice(0, 797) + "..."
        : line;
      return String(start + index + 1).padStart(5, " ") + " | " + normalizedLine;
    })
    .join("\n");
  return { start, end, text: excerpt };
}

/**
 * Retrieves bounded local project snippets using deterministic BM25 ranking.
 * Search is lexical only: no embeddings, remote APIs, or persistent indexes.
 * Obvious secret files, generated directories, binary files, and symbolic
 * links are excluded before content is read.
 */
export async function searchProjectContext(
  query: string,
  options: ProjectContextSearchOptions,
): Promise<ProjectContextSearchResult> {
  if (typeof query !== "string" || query.trim().length === 0 || query.length > 500) {
    throw new ProjectContextSearchError("Query must contain between 1 and 500 characters.");
  }

  const limit = validatePositiveInteger(options.limit, DEFAULTS.limit, "limit", 50);
  const maxCharacters = validatePositiveInteger(
    options.maxCharacters,
    DEFAULTS.maxCharacters,
    "maxCharacters",
    100_000,
  );
  if (maxCharacters < 128) {
    throw new ProjectContextSearchError("maxCharacters must be at least 128.");
  }
  const maxFiles = validatePositiveInteger(options.maxFiles, DEFAULTS.maxFiles, "maxFiles", 10_000);
  const maxFileBytes = validatePositiveInteger(
    options.maxFileBytes,
    DEFAULTS.maxFileBytes,
    "maxFileBytes",
    10 * 1024 * 1024,
  );
  const maxTotalBytes = validatePositiveInteger(
    options.maxTotalBytes,
    DEFAULTS.maxTotalBytes,
    "maxTotalBytes",
    256 * 1024 * 1024,
  );
  const maxSnippetLines = validatePositiveInteger(
    options.maxSnippetLines,
    DEFAULTS.maxSnippetLines,
    "maxSnippetLines",
    40,
  );

  const rawTerms = tokenize(query);
  if (rawTerms.length === 0) {
    throw new ProjectContextSearchError("Query must include at least one searchable word.");
  }
  const usefulTerms = [...new Set(rawTerms.filter((term) => !STOP_WORDS.has(term)))];
  const terms = usefulTerms.length > 0 ? usefulTerms : [...new Set(rawTerms)];
  const phrase = query.trim().toLowerCase().replace(/\s+/g, " ");

  let root: string;
  try {
    root = await realpath(resolve(options.projectRoot));
    const details = await stat(root);
    if (!details.isDirectory()) {
      throw new ProjectContextSearchError("Project root must be a directory.");
    }
  } catch (error) {
    if (error instanceof ProjectContextSearchError) throw error;
    throw new ProjectContextSearchError(
      "Project root does not exist or cannot be read.",
      { cause: error },
    );
  }

  const collected = await collectDocuments(root, {
    maxFiles,
    maxFileBytes,
    maxTotalBytes,
  });
  const ranked = rankDocuments(collected.documents, terms, phrase);

  const results: ProjectContextSnippet[] = [];
  let charactersUsed = 0;
  let truncated = collected.truncated;

  for (const candidate of ranked.slice(0, limit)) {
    const excerpt = createExcerpt(
      candidate.document,
      candidate.snippet_start,
      maxSnippetLines,
    );
    const resultNumber = results.length + 1;
    const header = "[" + resultNumber + "] " + candidate.document.path + ":" +
      (excerpt.start + 1) + "-" + excerpt.end +
      " (score " + candidate.score.toFixed(2) + ")";
    const matchedHeader = "Matched: " + candidate.matched_terms.join(", ");
    const headerCost = header.length + matchedHeader.length + 3;
    const remaining = maxCharacters - charactersUsed - headerCost;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    let text = excerpt.text;
    if (text.length > remaining) {
      text = text.slice(0, remaining);
      truncated = true;
    }
    if (text.trim().length === 0) {
      truncated = true;
      break;
    }

    results.push({
      path: candidate.document.path,
      line_start: excerpt.start + 1,
      line_end: excerpt.start + text.split("\n").length,
      score: Number(candidate.score.toFixed(4)),
      matched_terms: candidate.matched_terms,
      excerpt: text,
    });
    charactersUsed += headerCost + text.length;

    if (text.length < excerpt.text.length) break;
  }

  if (ranked.length > results.length) truncated = true;

  return {
    query: query.trim(),
    files_scanned: collected.documents.length,
    files_skipped: collected.filesSkipped,
    truncated,
    characters_used: charactersUsed,
    results,
  };
}

export interface ProjectMarkdownFile {
  path: string;
  content: string;
}

export interface ProjectMarkdownCollectionOptions {
  projectRoot: string;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface ProjectMarkdownCollection {
  files: ProjectMarkdownFile[];
  files_scanned: number;
  files_skipped: number;
  truncated: boolean;
}

/**
 * Collects Markdown documents using the same bounded, symlink-safe,
 * .gitignore-aware walker as project context retrieval.
 */
export async function collectProjectMarkdownFiles(
  options: ProjectMarkdownCollectionOptions,
): Promise<ProjectMarkdownCollection> {
  const maxFiles = validatePositiveInteger(
    options.maxFiles,
    5_000,
    "maxFiles",
    10_000,
  );
  const maxFileBytes = validatePositiveInteger(
    options.maxFileBytes,
    512 * 1024,
    "maxFileBytes",
    10 * 1024 * 1024,
  );
  const maxTotalBytes = validatePositiveInteger(
    options.maxTotalBytes,
    32 * 1024 * 1024,
    "maxTotalBytes",
    256 * 1024 * 1024,
  );

  let root: string;
  try {
    root = await realpath(resolve(options.projectRoot));
    const details = await stat(root);
    if (!details.isDirectory()) {
      throw new ProjectContextSearchError("Project root must be a directory.");
    }
  } catch (error) {
    if (error instanceof ProjectContextSearchError) throw error;
    throw new ProjectContextSearchError(
      "Project root does not exist or cannot be read.",
      { cause: error },
    );
  }

  const collected = await collectDocuments(root, {
    maxFiles,
    maxFileBytes,
    maxTotalBytes,
    markdownOnly: true,
  });
  const files = collected.documents.map((document) => ({
    path: document.path,
    content: document.content,
  }));

  return {
    files,
    files_scanned: files.length,
    files_skipped: collected.filesSkipped,
    truncated: collected.truncated,
  };
}
