import type { StageRunState } from "../state/types.js";
import type { WorkflowConditionDefinition } from "./types.js";

export interface WorkflowConditionContext {
  inputs: Record<string, unknown>;
  project: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  stages: Record<string, StageRunState>;
}

export class WorkflowConditionEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowConditionEvaluationError";
  }
}

interface ResolvedReference {
  found: boolean;
  value?: unknown;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function lookupPath(root: unknown, segments: string[]): ResolvedReference {
  let value = root;
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "__proto__" ||
      segment === "prototype" ||
      segment === "constructor" ||
      !isObjectRecord(value) ||
      !Object.prototype.hasOwnProperty.call(value, segment)
    ) return { found: false };
    value = value[segment];
  }
  return { found: true, value };
}

function resolveReference(reference: string, context: WorkflowConditionContext): ResolvedReference {
  const parts = reference.split(".");
  const root = parts.shift();
  if (!root || parts.length === 0) return { found: false };
  if (root === "input") return lookupPath(context.inputs, parts);
  if (root === "project") return lookupPath(context.project, parts);
  if (root === "capability") return lookupPath(context.capabilities, parts);
  if (root === "stage") {
    if (parts.length < 2) return { found: false };
    const stageId = parts.shift()!;
    const stage = context.stages[stageId];
    if (!stage) return { found: false };
    return lookupPath(stage, parts);
  }
  return { found: false };
}

function isReferenceOperand(operand: unknown): operand is { ref: string } {
  return isObjectRecord(operand) &&
    Object.keys(operand).length === 1 &&
    typeof operand.ref === "string";
}

function resolveOperand(operand: unknown, context: WorkflowConditionContext): unknown {
  if (!isReferenceOperand(operand)) return operand;
  const result = resolveReference(operand.ref, context);
  if (!result.found) {
    throw new WorkflowConditionEvaluationError(
      'Condition reference "' + operand.ref + '" could not be resolved.',
    );
  }
  return result.value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" || left === null ||
    typeof right !== "object" || right === null
  ) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function evaluateWorkflowCondition(
  condition: WorkflowConditionDefinition,
  context: WorkflowConditionContext,
): boolean {
  let visitedNodes = 0;
  const evaluate = (current: WorkflowConditionDefinition, depth: number): boolean => {
    visitedNodes += 1;
    if (depth > 16 || visitedNodes > 128) {
      throw new WorkflowConditionEvaluationError(
        "Condition exceeds the maximum expression complexity.",
      );
    }
    const expression = current.expression;
    switch (expression.op) {
      case "exists":
        return resolveReference(expression.ref, context).found;
      case "not":
        return !evaluate(expression.item, depth + 1);
      case "and":
        return expression.items.every((item) => evaluate(item, depth + 1));
      case "or":
        return expression.items.some((item) => evaluate(item, depth + 1));
      case "eq":
        return valuesEqual(
          resolveOperand(expression.left, context),
          resolveOperand(expression.right, context),
        );
      case "neq":
        return !valuesEqual(
          resolveOperand(expression.left, context),
          resolveOperand(expression.right, context),
        );
      case "in": {
        const left = resolveOperand(expression.left, context);
        const right = resolveOperand(expression.right, context);
        if (!Array.isArray(right)) {
          throw new WorkflowConditionEvaluationError('The right operand of "in" must resolve to an array.');
        }
        return right.some((item) => valuesEqual(left, item));
      }
    }
  };
  return evaluate(condition, 0);
}
