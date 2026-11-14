import { describe, expect, it } from "vitest";
import { evaluateWorkflowCondition } from "./condition.js";
import type { WorkflowConditionDefinition } from "./types.js";

const context = {
  inputs: { requires_ui: true, theme: "dark", features: ["search", "export"] },
  project: { id: "demo", mode: "brownfield" },
  capabilities: { browser_automation: true },
  stages: {
    discovery: {
      stage_id: "discovery",
      status: "completed" as const,
      attempt: 1,
      inputs: [],
      outputs: [],
      last_event_sequence: 2,
    },
  },
};

describe("evaluateWorkflowCondition", () => {
  it("evaluates input and project references", () => {
    const condition: WorkflowConditionDefinition = {
      expression: {
        op: "and",
        items: [
          { expression: { op: "eq", left: { ref: "input.requires_ui" }, right: true } },
          { expression: { op: "eq", left: { ref: "project.mode" }, right: "brownfield" } },
        ],
      },
    };
    expect(evaluateWorkflowCondition(condition, context)).toBe(true);
  });

  it("evaluates stage and capability references", () => {
    const condition: WorkflowConditionDefinition = {
      expression: {
        op: "and",
        items: [
          { expression: { op: "eq", left: { ref: "stage.discovery.status" }, right: "completed" } },
          { expression: { op: "eq", left: { ref: "capability.browser_automation" }, right: true } },
        ],
      },
    };
    expect(evaluateWorkflowCondition(condition, context)).toBe(true);
  });

  it("supports in, not, or, and exists", () => {
    const condition: WorkflowConditionDefinition = {
      expression: {
        op: "and",
        items: [
          { expression: { op: "in", left: "search", right: { ref: "input.features" } } },
          { expression: { op: "not", item: { expression: { op: "eq", left: { ref: "input.theme" }, right: "light" } } } },
          { expression: { op: "exists", ref: "project.id" } },
          { expression: { op: "or", items: [
            { expression: { op: "eq", left: { ref: "input.theme" }, right: "dark" } },
            { expression: { op: "eq", left: { ref: "input.theme" }, right: "system" } },
          ] } },
        ],
      },
    };
    expect(evaluateWorkflowCondition(condition, context)).toBe(true);
  });

  it("returns false for exists when a reference is missing", () => {
    expect(evaluateWorkflowCondition({
      expression: { op: "exists", ref: "capability.unknown" },
    }, context)).toBe(false);
  });

  it("fails closed for unresolved comparison references", () => {
    expect(() => evaluateWorkflowCondition({
      expression: { op: "eq", left: { ref: "input.unknown" }, right: true },
    }, context)).toThrow(/could not be resolved/);
  });

  it("rejects prototype traversal", () => {
    expect(evaluateWorkflowCondition({
      expression: { op: "exists", ref: "input.__proto__.polluted" },
    }, context)).toBe(false);
  });
});
