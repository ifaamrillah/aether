export type RunStatus =
  | "created"
  | "running"
  | "paused"
  | "blocked"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type StageStatus =
  | "pending"
  | "ready"
  | "in_progress"
  | "blocked"
  | "awaiting_approval"
  | "verifying"
  | "completed"
  | "failed"
  | "skipped"
  | "stale";

export type ApprovalRisk = "low" | "medium" | "high" | "critical";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "revoked";

export interface ApprovalAction {
  id: string;
  type: string;
  target?: string;
  risk: ApprovalRisk;
  requested_by: string;
  context: Record<string, unknown>;
}

export interface ApprovalDecisionReceipt {
  schema_version: 1;
  approval_id: string;
  action_digest: string;
  decision: "approved" | "rejected";
  issuer: string;
  subject: string;
  key_id: string;
  issued_at: string;
  expires_at: string;
  reason?: string;
  signature: string;
}

export interface ApprovalRecord {
  schema_version: 1;
  id: string;
  action: ApprovalAction;
  status: ApprovalStatus;
  requested_at: string;
  requested_by: string;
  decided_at?: string;
  decided_by?: string;
  decision_reason?: string;
  expires_at?: string;
  policy_version: string;
  action_digest: string;
  authorization_receipt?: ApprovalDecisionReceipt;
}

export interface ArtifactReference {
  artifact_id: string;
  path: string;
  type: string;
}

export interface StageVerificationReference {
  artifact_id: string;
  path: string;
  status: "passed";
  evidence_count: number;
  verified_at: string;
  sha256: string;
}

export interface StageRunState {
  stage_id: string;
  status: StageStatus;
  attempt: number;
  inputs: ArtifactReference[];
  outputs: ArtifactReference[];
  started_at?: string;
  completed_at?: string;
  blocked_reason?: string;
  approval_id?: string;
  verification?: StageVerificationReference;
  last_event_sequence: number;
}

export interface WorkflowRunSnapshot {
  schema_version: 1;
  id: string;
  workflow_id: string;
  workflow_version: number;
  status: RunStatus;
  project_id: string;
  inputs: Record<string, unknown>;
  stages: Record<string, StageRunState>;
  current_stage_ids: string[];
  created_at: string;
  updated_at: string;
  last_event_sequence: number;
  snapshot_sequence: number;
  artifact_manifest?: string;
}

export interface WorkflowEvent {
  schema_version: 1;
  event_id: string;
  run_id: string;
  sequence: number;
  type: string;
  timestamp: string;
  actor: {
    type: "user" | "agent" | "system";
    id: string;
  };
  entity: {
    type: string;
    id: string;
  };
  payload: Record<string, unknown>;
  correlation_id?: string;
}

export interface LoadedRun {
  snapshot: WorkflowRunSnapshot;
  pendingEvents: WorkflowEvent[];
}
