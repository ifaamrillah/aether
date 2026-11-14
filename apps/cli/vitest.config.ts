import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@aether/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
      "@aether/schemas": fileURLToPath(
        new URL("../../packages/schemas/src/index.ts", import.meta.url),
      ),
      "@aether/adapters": fileURLToPath(
        new URL("../../packages/adapters/src/index.ts", import.meta.url),
      ),
    },
  },
});
