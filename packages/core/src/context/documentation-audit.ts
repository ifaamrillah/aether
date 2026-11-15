import { dirname, extname, relative, resolve, sep } from "node:path";
import { realpath, stat } from "node:fs/promises";
import {
  collectProjectMarkdownFiles,
  ProjectContextSearchError,
} from "./retrieval.js";

export interface DocumentationAuditOptions {
  projectRoot: string;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface BrokenDocumentationLink {
  sourcePath: string;
  line: number;
  href: string;
  reason: string;
  targetPath?: string;
}

export interface DocumentationAuditResult {
  filesChecked: number;
  linksChecked: number;
  filesSkipped: number;
  truncated: boolean;
  brokenLinks: BrokenDocumentationLink[];
}

interface MarkdownLink {
  href: string;
  line: number;
}

interface ResolvedTarget {
  path: string;
  markdownPath?: string;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (
    path !== ".." &&
    !path.startsWith(".." + sep) &&
    !/^[A-Za-z]:/.test(path)
  );
}

function lineNumberAt(content: string, offset: number): number {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function parseMarkdownDestination(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("<")) {
    const closing = trimmed.indexOf(">");
    if (closing >= 0) return trimmed.slice(1, closing).trim();
  }

  let depth = 0;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (/\s/.test(character) && depth === 0) {
      return trimmed.slice(0, index);
    }
  }
  return trimmed;
}

function maskMarkdownCode(content: string): string {
  const masked = content.split("");
  const maskRange = (start: number, end: number): void => {
    for (let index = start; index < end; index += 1) {
      if (masked[index] !== "\n" && masked[index] !== "\r") masked[index] = " ";
    }
  };

  let offset = 0;
  let fenceCharacter: string | undefined;
  let fenceLength = 0;
  for (const line of content.split("\n")) {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const character = fence[1]![0]!;
      const length = fence[1]!.length;
      maskRange(offset, offset + line.length);
      if (fenceCharacter === undefined) {
        fenceCharacter = character;
        fenceLength = length;
      } else if (character === fenceCharacter && length >= fenceLength) {
        fenceCharacter = undefined;
        fenceLength = 0;
      }
    } else if (fenceCharacter !== undefined) {
      maskRange(offset, offset + line.length);
    }
    offset += line.length + 1;
  }

  const withoutFences = masked.join("");
  const inlineCode = /`+[sS]*?`+/g;
  let match: RegExpExecArray | null;
  while ((match = inlineCode.exec(withoutFences)) !== null) {
    maskRange(match.index, match.index + match[0].length);
  }
  return masked.join("");
}

function extractMarkdownLinks(content: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const visible = maskMarkdownCode(content);
  const inlinePattern = /!?\[[^\]]*\]\(/g;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(visible)) !== null) {
    const destinationStart = inlinePattern.lastIndex;
    let depth = 1;
    let escaped = false;
    let closingIndex = -1;

    for (let index = destinationStart; index < visible.length; index += 1) {
      const character = visible[index]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "(") depth += 1;
      if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          closingIndex = index;
          break;
        }
      }
    }

    if (closingIndex < 0) continue;
    const rawDestination = content.slice(destinationStart, closingIndex);
    const href = parseMarkdownDestination(rawDestination);
    if (href.length > 0) {
      links.push({ href, line: lineNumberAt(content, match.index) });
    }
    inlinePattern.lastIndex = closingIndex + 1;
  }

  const definitionPattern = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*(<[^>]+>|(?:\\.|[^\s]+))/gm;
  while ((match = definitionPattern.exec(visible)) !== null) {
    const href = parseMarkdownDestination(match[1] ?? "");
    if (href.length > 0) {
      links.push({ href, line: lineNumberAt(content, match.index) });
    }
  }

  return links.sort((left, right) => left.line - right.line);
}

function headingSlug(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\x60+/g, "")
    .replace(/&amp;/gi, "and")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function extractMarkdownAnchors(content: string): Set<string> {
  const anchors = new Set<string>();
  const duplicateCounts = new Map<string, number>();
  const lines = content.split(/\r?\n/);
  let fenceCharacter: string | undefined;
  let fenceLength = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const fence = trimmed.match(/^(\x60{3,}|~{3,})/);
    if (fence) {
      const character = fence[1]![0]!;
      if (fenceCharacter === undefined) {
        fenceCharacter = character;
        fenceLength = fence[1]!.length;
      } else if (character === fenceCharacter && fence[1]!.length >= fenceLength) {
        fenceCharacter = undefined;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceCharacter !== undefined) continue;

    for (const htmlAnchor of line.matchAll(/\b(?:id|name)=["']([^"']+)["']/gi)) {
      const value = htmlAnchor[1]?.trim();
      if (value) anchors.add(value);
    }

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;

    let title = heading[1]!;
    const explicitId = title.match(/\s+\{#([^}\s]+)\}\s*$/);
    if (explicitId) {
      anchors.add(explicitId[1]!);
      title = title.slice(0, explicitId.index).trimEnd();
    }

    const baseSlug = headingSlug(title);
    if (!baseSlug) continue;
    const occurrence = duplicateCounts.get(baseSlug) ?? 0;
    duplicateCounts.set(baseSlug, occurrence + 1);
    anchors.add(occurrence === 0 ? baseSlug : baseSlug + "-" + occurrence);
  }

  return anchors;
}

function splitHref(href: string): { path: string; fragment: string } {
  const hashIndex = href.indexOf("#");
  const beforeFragment = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const fragment = hashIndex >= 0 ? href.slice(hashIndex + 1) : "";
  const queryIndex = beforeFragment.indexOf("?");
  return {
    path: queryIndex >= 0 ? beforeFragment.slice(0, queryIndex) : beforeFragment,
    fragment,
  };
}

async function resolveLocalTarget(
  root: string,
  sourcePath: string,
  hrefPath: string,
): Promise<{ target?: ResolvedTarget; reason?: string }> {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(hrefPath);
  } catch {
    return { reason: "link path contains invalid percent encoding" };
  }

  const sourceAbsolute = resolve(root, ...sourcePath.split("/"));
  const basePath = decodedPath.startsWith("/")
    ? resolve(root, decodedPath.slice(1))
    : resolve(dirname(sourceAbsolute), decodedPath);

  if (!isWithinRoot(root, basePath)) {
    return { reason: "link resolves outside the project root" };
  }

  const candidates = [basePath];
  if (extname(basePath).length === 0) {
    candidates.push(
      basePath + ".md",
      basePath + ".mdx",
      resolve(basePath, "index.md"),
      resolve(basePath, "README.md"),
      resolve(basePath, "index.mdx"),
      resolve(basePath, "README.mdx"),
    );
  }

  for (const candidate of candidates) {
    try {
      const canonicalPath = await realpath(candidate);
      if (!isWithinRoot(root, canonicalPath)) {
        return { reason: "link target resolves outside the project root" };
      }
      const details = await stat(canonicalPath);
      const relativePath = relative(root, canonicalPath).split(sep).join("/");

      if (details.isDirectory()) {
        for (const indexName of ["index.md", "README.md", "index.mdx", "README.mdx"]) {
          try {
            const indexPath = await realpath(resolve(canonicalPath, indexName));
            if (!isWithinRoot(root, indexPath)) continue;
            const indexDetails = await stat(indexPath);
            if (indexDetails.isFile()) {
              const markdownPath = relative(root, indexPath).split(sep).join("/");
              return { target: { path: relativePath, markdownPath } };
            }
          } catch {
            // Try the next conventional index document.
          }
        }
        return { target: { path: relativePath } };
      }

      if (details.isFile()) {
        const markdownPath = [".md", ".mdx"].includes(extname(canonicalPath).toLowerCase())
          ? relativePath
          : undefined;
        return { target: { path: relativePath, ...(markdownPath ? { markdownPath } : {}) } };
      }
    } catch {
      // Try extension/index fallbacks before reporting a missing link.
    }
  }

  return { reason: "link target does not exist" };
}

/**
 * Checks local Markdown links and heading anchors using the same bounded,
 * .gitignore-aware project walker as context retrieval. External URLs are
 * intentionally not fetched or checked.
 */
export async function auditProjectDocumentation(
  options: DocumentationAuditOptions,
): Promise<DocumentationAuditResult> {
  const root = await realpath(resolve(options.projectRoot)).catch((error: unknown) => {
    throw new ProjectContextSearchError(
      "Project root does not exist or cannot be read.",
      { cause: error },
    );
  });
  const collection = await collectProjectMarkdownFiles(options);
  const documents = new Map(collection.files.map((file) => [file.path, file.content]));
  const anchors = new Map<string, Set<string>>();
  const brokenLinks: BrokenDocumentationLink[] = [];
  let linksChecked = 0;

  for (const file of collection.files) {
    for (const link of extractMarkdownLinks(file.content)) {
      const href = link.href.trim();
      if (
        href.length === 0 ||
        href.startsWith("//") ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/.test(href)
      ) {
        continue;
      }

      const { path: hrefPath, fragment } = splitHref(href);
      const resolved = await resolveLocalTarget(root, file.path, hrefPath);
      linksChecked += 1;

      if (!resolved.target) {
        brokenLinks.push({
          sourcePath: file.path,
          line: link.line,
          href,
          reason: resolved.reason ?? "link target could not be resolved",
        });
        continue;
      }

      if (fragment.length === 0 || !resolved.target.markdownPath) continue;
      const targetMarkdown = resolved.target.markdownPath;
      const targetContent = documents.get(targetMarkdown);
      if (targetContent === undefined) continue;

      let decodedFragment: string;
      try {
        decodedFragment = decodeURIComponent(fragment);
      } catch {
        brokenLinks.push({
          sourcePath: file.path,
          line: link.line,
          href,
          targetPath: targetMarkdown,
          reason: "fragment contains invalid percent encoding",
        });
        continue;
      }

      let targetAnchors = anchors.get(targetMarkdown);
      if (!targetAnchors) {
        targetAnchors = extractMarkdownAnchors(targetContent);
        anchors.set(targetMarkdown, targetAnchors);
      }
      if (!targetAnchors.has(decodedFragment)) {
        brokenLinks.push({
          sourcePath: file.path,
          line: link.line,
          href,
          targetPath: targetMarkdown,
          reason: "heading anchor not found",
        });
      }
    }
  }

  brokenLinks.sort((left, right) =>
    left.sourcePath.localeCompare(right.sourcePath, "en") ||
    left.line - right.line ||
    left.href.localeCompare(right.href, "en"),
  );

  return {
    filesChecked: collection.files.length,
    linksChecked,
    filesSkipped: collection.files_skipped,
    truncated: collection.truncated,
    brokenLinks,
  };
}
