import type {
  WorkflowDefinition,
  WorkflowPlanResult,
  WorkflowValidationIssue,
} from "./types.js";

/**
 * Checks references and dependency graph semantics after a workflow has
 * passed its JSON Schema validation.
 */
export function validateWorkflowSemantics(
  workflow: WorkflowDefinition,
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const stagesById = new Map<string, WorkflowDefinition["stages"][number]>();

  workflow.stages.forEach((stage, index) => {
    if (stagesById.has(stage.id)) {
      issues.push({
        code: "duplicate_stage_id",
        path: `stages[${index}].id`,
        message: `Stage id "${stage.id}" is defined more than once.`,
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
          path: `stages[${index}].depends_on`,
          message: `Stage "${stage.id}" cannot depend on itself.`,
        });
      } else if (!stagesById.has(dependency)) {
        issues.push({
          code: "unknown_dependency",
          path: `stages[${index}].depends_on`,
          message: `Stage "${stage.id}" depends on unknown stage "${dependency}".`,
        });
      }
    }
  });

  for (const [index, stageId] of (workflow.entry_stages ?? []).entries()) {
    if (!stagesById.has(stageId)) {
      issues.push({
        code: "unknown_entry_stage",
        path: `entry_stages[${index}]`,
        message: `Entry stage "${stageId}" is not defined.`,
      });
    }
  }

  for (const [index, stageId] of workflow.completion.required_stages.entries()) {
    if (!stagesById.has(stageId)) {
      issues.push({
        code: "unknown_required_stage",
        path: `completion.required_stages[${index}]`,
        message: `Required completion stage "${stageId}" is not defined.`,
      });
    }
  }

  const visitState = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();

  const visit = (stageId: string): void => {
    const state = visitState.get(stageId);
    if (state === "visited" || state === "visiting") return;

    visitState.set(stageId, "visiting");
    stack.push(stageId);

    const stage = stagesById.get(stageId);
    for (const dependency of stage?.depends_on ?? []) {
      if (!stagesById.has(dependency)) continue;

      if (visitState.get(dependency) === "visiting") {
        const cycleStart = stack.indexOf(dependency);
        const cycle = [...stack.slice(cycleStart), dependency];
        const cycleKey = cycle.join(" -> ");

        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          issues.push({
            code: "dependency_cycle",
            path: "stages",
            message: `Workflow dependency cycle detected: ${cycleKey}.`,
          });
        }
        continue;
      }

      visit(dependency);
    }

    stack.pop();
    visitState.set(stageId, "visited");
  };

  for (const stage of workflow.stages) {
    visit(stage.id);
  }

  return issues;
}

/**
 * Produces deterministic topological execution waves. Stages in one wave
 * have no dependencies on other stages in that same wave.
 */
export function buildExecutionWaves(
  workflow: WorkflowDefinition,
): WorkflowPlanResult {
  const issues = validateWorkflowSemantics(workflow);
  if (issues.length > 0) return { ok: false, issues };

  const remaining = new Set(workflow.stages.map((stage) => stage.id));
  const completed = new Set<string>();
  const waves: string[][] = [];

  while (remaining.size > 0) {
    const wave = workflow.stages
      .filter((stage) => remaining.has(stage.id))
      .filter((stage) =>
        (stage.depends_on ?? []).every((dependency) => completed.has(dependency)),
      )
      .map((stage) => stage.id);

    // Defensive guard: the semantic validator should already identify cycles.
    if (wave.length === 0) {
      return {
        ok: false,
        issues: [
          {
            code: "dependency_cycle",
            path: "stages",
            message: "Unable to construct an execution plan due to unresolved dependencies.",
          },
        ],
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
