# Local Project Context Retrieval

## Purpose

The first Aether context-retrieval primitive is a deterministic local search service. It gives an agent a small, source-linked context pack without requiring a hosted vector database, model embeddings, or an external indexing service.

## CLI

```bash
aether context search "workflow recovery" --limit 5 --max-chars 6000
aether context search "authentication boundary" --project ../service --limit 8
```

The command prints ranked file excerpts with relative paths, line ranges, matched terms, and a relevance score. It does not write project files or create a persistent index.

## Retrieval behavior

- Tokenizes the query and file text, then ranks documents using BM25-style lexical scoring.
- Adds a small relevance boost when query terms appear in a relative file path.
- Returns one bounded excerpt per matching file.
- Orders ties deterministically by relative path.
- Uses only the local filesystem; it does not make network requests or use embeddings.
- Search is lexical, not semantic. Use precise domain terms, symbols, or identifiers for better results.

## Default limits

| Limit | Default |
|---|---:|
| Result files | 8 |
| Excerpt budget | 12,000 characters |
| Files read | 2,000 |
| Maximum individual file | 256 KiB |
| Total content read | 16 MiB |
| Lines per excerpt | 12 |

The CLI can adjust the result count and excerpt budget with `--limit` and `--max-chars`. The service also exposes bounds for file count and bytes to callers in TypeScript.

## Exclusions

The retriever skips common generated/dependency/cache directories, including `.git`, `.aether`, `node_modules`, `dist`, `build`, `coverage`, and common framework caches. It also skips symbolic links, binary files, large files, common secret filenames, environment files other than `.env.example`, credential/key file extensions, and lockfiles.

## Safety boundaries and known gaps

This is a context retrieval filter, not a secret scanner or a filesystem sandbox. The retriever reads root and nested `.gitignore` files and supports common comments, directory patterns, anchored paths, `*`, `**`, `?`, character classes, negation rules, and escaped leading `#`/`!`. Rules are applied in order, with nested files scoped to their directory. A directory excluded by a rule is not traversed, so a child cannot be re-included unless its parent remains traversable. Built-in safety exclusions for environment/credential files and common generated/dependency directories cannot be overridden by negation rules. The matcher targets common `.gitignore` patterns rather than every Git wildmatch edge case. Obvious credential filenames and standard generated directories are excluded, but sensitive values embedded in otherwise ordinary source/configuration files are not detected.

Context search is intended for trusted project workspaces. A future iteration can add full ignore-file semantics, explicit include/exclude configuration, incremental indexing, and semantic retrieval without changing the current source-path/line-range result contract.
