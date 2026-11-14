export const AETHER_VERSION = "0.1.0" as const;

export function getAetherVersion(): string {
  return AETHER_VERSION;
}

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export * from "./workflow/index.js";

export * from "./state/index.js";
