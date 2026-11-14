import { parse } from "yaml";
import { buildExecutionWaves, validateWorkflowSemantics } from "@aether/core";
import type { WorkflowDefinition } from "@aether/core";
import { validateWorkflowDefinition } from "@aether/schemas";

export type WorkflowDefinitionParseResult =
  | { ok: true; definition: WorkflowDefinition }
  | { ok: false; errors: string[] };

export type WorkflowContentValidation =
  | {
      ok: true;
      workflowId: string;
      version: number;
      waves: string[][];
    }
  | {
      ok: false;
      errors: string[];
    };

/** Parses YAML and applies both structural and semantic workflow validation. */
export function parseWorkflowDefinition(
  content: string,
): WorkflowDefinitionParseResult {
  let parsed: unknown;

  try {
    parsed = parse(content, { prettyErrors: true, uniqueKeys: true });
  } catch (error) {
    return {
      ok: false,
      errors: [
        error instanceof Error ? error.message : "Unable to parse workflow YAML.",
      ],
    };
  }

  const schemaResult = validateWorkflowDefinition(parsed);
  if (!schemaResult.valid) {
    return {
      ok: false,
      errors: schemaResult.errors.map(
        (issue) => issue.path + ": " + issue.message + " (" + issue.keyword + ")",
      ),
    };
  }

  const definition = parsed as WorkflowDefinition;
  const semanticIssues = validateWorkflowSemantics(definition);
  if (semanticIssues.length > 0) {
    return {
      ok: false,
      errors: semanticIssues.map(
        (issue) => issue.path + ": " + issue.message + " [" + issue.code + "]",
      ),
    };
  }

  return { ok: true, definition };
}

export function validateWorkflowContent(
  content: string,
): WorkflowContentValidation {
  const parsed = parseWorkflowDefinition(content);
  if (!parsed.ok) return parsed;

  const plan = buildExecutionWaves(parsed.definition);
  if (!plan.ok) {
    return {
      ok: false,
      errors: plan.issues.map((issue) => issue.message),
    };
  }

  return {
    ok: true,
    workflowId: parsed.definition.id,
    version: parsed.definition.version,
    waves: plan.waves,
  };
}
