import { describe, expect, it } from "vitest";
import { parseWorkflowRunOptions } from "./workflow-inputs.js";

describe("parseWorkflowRunOptions", () => {
  it("parses string, number, and boolean workflow inputs", () => {
    expect(
      parseWorkflowRunOptions([
        "--input", "description=Build account settings",
        "--input", "max_retries=3",
        "--input", "include_docs=true",
        "--project-id", "demo-project",
      ]),
    ).toEqual({
      inputs: {
        description: "Build account settings",
        max_retries: 3,
        include_docs: true,
      },
      projectId: "demo-project",
    });
  });

  it("preserves equals signs after the first separator", () => {
    expect(
      parseWorkflowRunOptions(["--input", "query=a=b=c"]).inputs,
    ).toEqual({ query: "a=b=c" });
  });

  it("rejects missing, duplicate, and malformed input flags", () => {
    expect(() => parseWorkflowRunOptions(["--input"])).toThrow(/Missing value/);
    expect(() =>
      parseWorkflowRunOptions(["--input", "name=one", "--input", "name=two"]),
    ).toThrow(/more than once/);
    expect(() =>
      parseWorkflowRunOptions(["--input", "=missing-name"]),
    ).toThrow(/Expected name=value/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseWorkflowRunOptions(["--unknown"])).toThrow(/Unknown workflow run option/);
  });
});
