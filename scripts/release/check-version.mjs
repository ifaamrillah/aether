import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "";
const expectedVersion = tag.replace(/^v/, "");
if (!/^[0-9]+[.][0-9]+[.][0-9]+(?:-[0-9A-Za-z.-]+)?(?:[+][0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
  throw new Error("Expected a semantic release tag such as v0.1.0.");
}

const manifests = [
  "package.json",
  "apps/cli/package.json",
  "packages/core/package.json",
  "packages/schemas/package.json",
  "packages/adapters/package.json",
];

for (const relativePath of manifests) {
  const manifest = JSON.parse(
    await readFile(resolve(process.cwd(), relativePath), "utf8"),
  );
  if (manifest.version !== expectedVersion) {
    throw new Error(
      relativePath + " is version " + manifest.version +
        "; all workspace packages must match release tag " + expectedVersion + ".",
    );
  }
}

console.log("All Aether workspace manifests match version " + expectedVersion + ".");
