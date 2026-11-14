import { describe, expect, it } from "vitest";
import { AETHER_VERSION, getAetherVersion } from "./index.js";

describe("@aether/core", () => {
  it("exports the initial version", () => {
    expect(getAetherVersion()).toBe("0.1.0");
    expect(AETHER_VERSION).toBe("0.1.0");
  });
});
