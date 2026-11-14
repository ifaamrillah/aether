import { describe, expect, it } from "vitest";
import { validateWorkflowContent } from "./workflow-validate.js";

const validWorkflow = `schema_version: 1
id: feature-development
version: 1
name: Feature Development
description: Validate and plan a small feature.
inputs: []
stages:
  - id: discovery
    skill: discovery
    required: true
  - id: implementation
    skill: implementation
    required: true
    depends_on:
      - discovery
completion:
  required_stages:
    - discovery
    - implementation
`;

describe("validateWorkflowContent", () => {
  it("validates and plans a valid YAML workflow", () => {
    expect(validateWorkflowContent(validWorkflow)).toEqual({
      ok: true,
      workflowId: "feature-development",
      version: 1,
      waves: [["discovery"], ["implementation"]],
    });
  });

  it("rejects workflows with unresolved stage dependencies", () => {
    const invalid = validWorkflow.replace(
      "- discovery\ncompletion:",
      "- missing-stage\ncompletion:",
    );

    const result = validateWorkflowContent(invalid);
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("unknown_dependency");
    }
  });

  it("reports malformed YAML without throwing", () => {
    const result = validateWorkflowContent("stages: [unclosed");
    expect(result.ok).toBe(false);
  });
});
