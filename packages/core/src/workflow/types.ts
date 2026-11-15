export interface WorkflowInputDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  description?: string;
  default?: unknown;
}

export type WorkflowConditionOperand = unknown;

export type WorkflowConditionExpression =
  | { op: "eq"; left: WorkflowConditionOperand; right: WorkflowConditionOperand }
  | { op: "neq"; left: WorkflowConditionOperand; right: WorkflowConditionOperand }
  | { op: "in"; left: WorkflowConditionOperand; right: WorkflowConditionOperand }
  | { op: "and"; items: WorkflowConditionDefinition[] }
  | { op: "or"; items: WorkflowConditionDefinition[] }
  | { op: "not"; item: WorkflowConditionDefinition }
  | { op: "exists"; ref: string };

export interface WorkflowConditionDefinition {
  expression: WorkflowConditionExpression;
}

export interface WorkflowStageDefinition {
  id: string;
  skill: string;
  required: boolean;
  name?: string;
  description?: string;
  depends_on?: string[];
  condition?: WorkflowConditionDefinition;
  approval?: {
    mode: "none" | "optional" | "required";
    risk?: "low" | "medium" | "high" | "critical";
    require_signature?: boolean;
    allowed_approvers?: string[];
    required_roles?: string[];
    prevent_self_approval?: boolean;
  };
  scope?: {
    read_paths?: string[];
    write_paths?: string[];
  };
  acceptance_criteria?: string[];
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
  | "unknown_required_stage"
  | "conditional_required_stage"
  | "conditional_dependency_outside_required_path"
  | "condition_unknown_input"
  | "condition_unknown_stage"
  | "condition_stage_reference_not_dependency"
  | "approval_policy_requires_signature"
  | "approval_signature_requires_gate";

export interface WorkflowValidationIssue {
  code: WorkflowValidationCode;
  path: string;
  message: string;
}

export type WorkflowPlanResult =
  | { ok: true; waves: string[][] }
  | { ok: false; issues: WorkflowValidationIssue[] };
