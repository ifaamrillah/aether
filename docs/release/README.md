# Package Release

Aether is a pnpm monorepo with one synchronized version across the CLI and workspace libraries.

## Packages

- `@aether/core`
- `@aether/schemas`
- `@aether/adapters`
- `@aether/cli`

The CLI tarball contains compiled JavaScript plus copied `skills/` and `workflows/` bundles. The CLI does not depend on the source repository being checked out after installation.

## Before the first npm release

1. Confirm the `@aether` npm scope is owned by the project maintainer and that the four package names are publishable. Search results are not a guarantee of npm's similarity/name policy.
2. Create an npm automation or granular access token with publish permissions for the selected scope.
3. Add it to GitHub repository Actions secrets as `NPM_TOKEN`.
4. Ensure all workspace package versions and the root version are synchronized.
5. Run `pnpm check`, `pnpm build`, and the package tarball installation CI job.
6. Review the changelog and publish intent before creating a release tag.

If the `@aether` scope is unavailable, rename all package names and every workspace dependency consistently before the first release. Do not publish under a different scope without updating documentation and package metadata.

## Release procedure

For a release version such as `0.1.0`:

1. Update the root and four workspace `package.json` versions to `0.1.0`.
2. Run `pnpm install --lockfile-only` and commit the synchronized manifests and lockfile.
3. Run `pnpm release:check -- v0.1.0` (or `node scripts/release/check-version.mjs v0.1.0`).
4. Push the commit and tag `v0.1.0`.
5. The GitHub Actions release workflow runs all checks and publishes packages recursively in dependency order.

The release workflow requires `NPM_TOKEN`; it is intentionally not triggered by ordinary commits. It does not create tags, publish releases, or modify package versions on behalf of contributors.

## Local package inspection

```bash
pnpm build
mkdir -p .artifacts
pnpm --filter @aether/core pack --pack-destination .artifacts
pnpm --filter @aether/schemas pack --pack-destination .artifacts
pnpm --filter @aether/adapters pack --pack-destination .artifacts
pnpm --filter @aether/cli pack --pack-destination .artifacts
```

The CLI archive should contain `dist/bundles/skills/` and `dist/bundles/workflows/`. CI also installs the four local tarballs into a clean temporary npm project and runs `aether init` and `aether workflow list`.
