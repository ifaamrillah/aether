import type {
  WorkflowConditionDefinition,
  WorkflowDefinition,
  WorkflowPlanResult,
  WorkflowStageDefinition,
  WorkflowValidationIssue,
} from "./types.js";

function collectReferences(condition: WorkflowConditionDefinition): string[] {
  const expression = condition.expression;
  if (expression.op === "exists") return [expression.ref];
  if (expression.op === "not") return collectReferences(expression.item);
  if (expression.op === "and" || expression.op === "or") {
    return expression.items.flatMap(collectReferences);
  }
  const references: string[] = [];
  for (const operand of [expression.left, expression.right]) {
    if (
      typeof operand === "object" &&
      operand !== null &&
      !Array.isArray(operand) &&
      Object.keys(operand).length === 1 &&
      typeof (operand as { ref?: unknown }).ref === "string"
    ) references.push((operand as { ref: string }).ref);
  }
  return references;
}

export function getRequiredExecutionStageIds(workflow: WorkflowDefinition): Set<string> {
  const stages = new Map(workflow.stages.map((stage) => [stage.id, stage] as const));
  const required = new Set<string>();
  const visit = (stageId: string): void => {
    if (required.has(stageId)) return;
    required.add(stageId);
    for (const dependency of stages.get(stageId)?.depends_on ?? []) visit(dependency);
  };
  for (const stageId of workflow.completion.required_stages) visit(stageId);
  return required;
}

function dependencyClosure(
  stage: WorkflowStageDefinition,
  stages: Map<string, WorkflowStageDefinition>,
): Set<string> {
  const ancestors = new Set<string>();
  const visit = (stageId: string): void => {
    if (ancestors.has(stageId)) return;
    ancestors.add(stageId);
    for (const parent of stages.get(stageId)?.depends_on ?? []) visit(parent);
  };
  for (const dependency of stage.depends_on ?? []) visit(dependency);
  return ancestors;
}

export function validateWorkflowSemantics(workflow: WorkflowDefinition): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const stagesById = new Map<string, WorkflowStageDefinition>();

  workflow.stages.forEach((stage, index) => {
    if (stagesById.has(stage.id)) {
      issues.push({
        code: "duplicate_stage_id",
        path: "stages[" + index + "].id",
        message: 'Stage id "' + stage.id + '" is defined more than once.',
      });
      return;
    }
    stagesById.set(stage.id, stage);
  });

  workflow.stages.forEach((stage, index) => {
    for (const dependency of stage.depends_on ?? []) {
      if (dependency === stage.id) {
        issues.push({
          code: "self_dependency",
          path: "stages[" + index + "].depends_on",
          message: 'Stage "' + stage.id + '" cannot depend on itself.',
        });
      } else if (!stagesById.has(dependency)) {
        issues.push({
          code: "unknown_dependency",
          path: "stages[" + index + "].depends_on",
          message: 'Stage "' + stage.id + '" depends on unknown stage "' + dependency + '".',
        });
      }
    }
  });

  for (const [index, stageId] of (workflow.entry_stages ?? []).entries()) {
    if (!stagesById.has(stageId)) {
      issues.push({
        code: "unknown_entry_stage",
        path: "entry_stages[" + index + "]",
        message: 'Entry stage "' + stageId + '" is not defined.',
      });
    }
  }

  for (const [index, stageId] of workflow.completion.required_stages.entries()) {
    if (!stagesById.has(stageId)) {
      issues.push({
        code: "unknown_required_stage",
        path: "completion.required_stages[" + index + "]",
        message: 'Required completion stage "' + stageId + '" is not defined.',
      });
    }
  }

  const visitState = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cycles = new Set<string>();
  const visit = (stageId: string): void => {
    const state = visitState.get(stageId);
    if (state === "visited" || state === "visiting") return;
    visitState.set(stageId, "visiting");
    stack.push(stageId);
    for (const dependency of stagesById.get(stageId)?.depends_on ?? []) {
      if (!stagesById.has(dependency)) continue;
      if (visitState.get(dependency) === "visiting") {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency];
        const key = cycle.join(" -> ");
        if (!cycles.has(key)) {
          cycles.add(key);
          issues.push({
            code: "dependency_cycle",
            path: "stages",
            message: "Workflow dependency cycle detected: " + key + ".",
          });
        }
      } else {
        visit(dependency);
      }
    }
    stack.pop();
    visitState.set(stageId, "visited");
  };
  for (const stage of workflow.stages) visit(stage.id);

  const requiredPath = getRequiredExecutionStageIds(workflow);
  const inputNames = new Set(workflow.inputs.map((input) => input.name));
  workflow.stages.forEach((stage, index) => {
    if (!stage.condition) return;
    if (stage.required || requiredPath.has(stage.id)) {
      issues.push({
        code: "conditional_required_stage",
        path: "stages[" + index + "].condition",
        message: 'Conditional stage "' + stage.id + '" cannot be required or be a dependency of a required completion stage.',
      });
    }
    for (const dependency of stage.depends_on ?? []) {
      if (!requiredPath.has(dependency)) {
        issues.push({
          code: "conditional_dependency_outside_required_path",
          path: "stages[" + index + "].depends_on",
          message: 'Conditional stage "' + stage.id + '" may depend only on stages in the required completion path.',
        });
      }
    }
    const ancestors = dependencyClosure(stage, stagesById);
    for (const reference of collectReferences(stage.condition)) {
      const parts = reference.split(".");
      const root = parts[0];
      if (parts.some((part) =>
        part.length === 0 || part === "__proto__" || part === "prototype" || part === "constructor"
      )) {
        issues.push({
          code: "condition_unknown_stage",
          path: "stages[" + index + "].condition",
          message: 'Condition reference "' + reference + '" contains an unsafe path segment.',
        });
      } else if (root === "input" && parts.length >= 2 && !inputNames.has(parts[1]!)) {
        issues.push({
          code: "condition_unknown_input",
          path: "stages[" + index + "].condition",
          message: 'Condition references unknown workflow input "' + parts[1] + '".',
        });
      } else if (root === "stage" && parts.length >= 3) {
        const refStage = parts[1]!;
        if (!stagesById.has(refStage)) {
          issues.push({
            code: "condition_unknown_stage",
            path: "stages[" + index + "].condition",
            message: 'Condition references unknown stage "' + refStage + '".',
          });
        } else if (!ancestors.has(refStage)) {
          issues.push({
            code: "condition_stage_reference_not_dependency",
            path: "stages[" + index + "].condition",
            message: 'Condition stage reference "' + refStage + '" must be a declared transitive dependency.',
          });
        }
      }
    }
  });

  return issues;
}

export function buildExecutionWaves(workflow: WorkflowDefinition): WorkflowPlanResult {
  const issues = validateWorkflowSemantics(workflow);
  if (issues.length > 0) return { ok: false, issues };

  const remaining = new Set(workflow.stages.map((stage) => stage.id));
  const completed = new Set<string>();
  const waves: string[][] = [];
  while (remaining.size > 0) {
    const wave = workflow.stages
      .filter((stage) => remaining.has(stage.id))
      .filter((stage) => (stage.depends_on ?? []).every((dependency) => completed.has(dependency)))
      .map((stage) => stage.id);
    if (wave.length === 0) {
      return {
        ok: false,
        issues: [{
          code: "dependency_cycle",
          path: "stages",
          message: "Unable to construct an execution plan due to unresolved dependencies.",
        }],
      };
    }
    waves.push(wave);
    for (const stageId of wave) {
      remaining.delete(stageId);
      completed.add(stageId);
    }
  }
  return { ok: true, waves };
}
