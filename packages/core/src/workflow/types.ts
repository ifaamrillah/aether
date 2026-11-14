export interface WorkflowInputDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  description?: string;
  default?: unknown;
}

export interface WorkflowStageDefinition {
  id: string;
  skill: string;
  required: boolean;
  name?: string;
  description?: string;
  depends_on?: string[];
}

export interface WorkflowDefinition {
  schema_version: 1;
  id: string;
  version: number;
  name: string;
  description: string;
  inputs: WorkflowInputDefinition[];
  entry_stages?: string[];
  stages: WorkflowStageDefinition[];
  completion: {
    required_stages: string[];
  };
}

export type WorkflowValidationCode =
  | "duplicate_stage_id"
  | "unknown_dependency"
  | "self_dependency"
  | "dependency_cycle"
  | "unknown_entry_stage"
  | "unknown_required_stage";

export interface WorkflowValidationIssue {
  code: WorkflowValidationCode;
  path: string;
  message: string;
}

export type WorkflowPlanResult =
  | { ok: true; waves: string[][] }
  | { ok: false; issues: WorkflowValidationIssue[] };
