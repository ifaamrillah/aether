import { describe, expect, it } from "vitest";
import {
  buildExecutionWaves,
  validateWorkflowSemantics,
} from "./validate-workflow.js";
import type { WorkflowDefinition } from "./types.js";

function workflow(
  stages: WorkflowDefinition["stages"],
): WorkflowDefinition {
  return {
    schema_version: 1,
    id: "test-workflow",
    version: 1,
    name: "Test workflow",
    description: "Workflow fixture for semantic validation.",
    inputs: [],
    stages,
    completion: { required_stages: stages.map((stage) => stage.id) },
  };
}

describe("validateWorkflowSemantics", () => {
  it("accepts a valid workflow DAG", () => {
    const definition = workflow([
      { id: "discovery", skill: "discovery", required: true },
      {
        id: "planning",
        skill: "planning",
        required: true,
        depends_on: ["discovery"],
      },
      {
        id: "implementation",
        skill: "implementation",
        required: true,
        depends_on: ["planning"],
      },
    ]);

    expect(validateWorkflowSemantics(definition)).toEqual([]);
  });

  it("reports duplicate stage identifiers", () => {
    const definition = workflow([
      { id: "review", skill: "review", required: true },
      { id: "review", skill: "review", required: true },
    ]);

    expect(validateWorkflowSemantics(definition).map((issue) => issue.code))
      .toContain("duplicate_stage_id");
  });

  it("reports references to missing stages", () => {
    const definition = {
      ...workflow([
        {
          id: "implementation",
          skill: "implementation",
          required: true,
          depends_on: ["planning"],
        },
      ]),
      entry_stages: ["missing-entry"],
      completion: { required_stages: ["missing-completion"] },
    } satisfies WorkflowDefinition;

    const codes = validateWorkflowSemantics(definition).map((issue) => issue.code);
    expect(codes).toContain("unknown_dependency");
    expect(codes).toContain("unknown_entry_stage");
    expect(codes).toContain("unknown_required_stage");
  });

  it("detects circular dependencies", () => {
    const definition = workflow([
      { id: "a", skill: "a", required: true, depends_on: ["b"] },
      { id: "b", skill: "b", required: true, depends_on: ["c"] },
      { id: "c", skill: "c", required: true, depends_on: ["a"] },
    ]);

    expect(validateWorkflowSemantics(definition).map((issue) => issue.code))
      .toContain("dependency_cycle");
  });
});

describe("buildExecutionWaves", () => {
  it("groups independent stages and preserves declaration order", () => {
    const definition = workflow([
      { id: "discovery", skill: "discovery", required: true },
      { id: "design", skill: "design", required: true },
      {
        id: "specification",
        skill: "specification",
        required: true,
        depends_on: ["discovery", "design"],
      },
      {
        id: "implementation",
        skill: "implementation",
        required: true,
        depends_on: ["specification"],
      },
    ]);

    expect(buildExecutionWaves(definition)).toEqual({
      ok: true,
      waves: [
        ["discovery", "design"],
        ["specification"],
        ["implementation"],
      ],
    });
  });

  it("refuses to plan an invalid workflow", () => {
    const definition = workflow([
      { id: "a", skill: "a", required: true, depends_on: ["a"] },
    ]);

    const result = buildExecutionWaves(definition);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("self_dependency");
    }
  });
});
