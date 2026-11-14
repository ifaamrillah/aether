import { cp, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(cliRoot, "../..");
const outputRoot = resolve(cliRoot, "dist", "bundles");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const bundleName of ["skills", "workflows"]) {
  const source = await realpath(resolve(repositoryRoot, bundleName));
  const destination = resolve(outputRoot, bundleName);
  await cp(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  });
}

console.log("Copied portable skills and workflow bundles into " + outputRoot);
