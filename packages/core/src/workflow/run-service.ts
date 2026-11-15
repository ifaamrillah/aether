import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { FileStateStore } from "../state/file-state-store.js";
import type {
  RunStatus,
  StageRunState,
  StageStatus,
  WorkflowEvent,
  WorkflowRunSnapshot,
  StageVerificationReference,
  ApprovalRecord,
} from "../state/types.js";
import { transitionStageState } from "../state/stage-transitions.js";
import { StateIntegrityError } from "../state/errors.js";
import {
  RunRecoveryRequiredError,
  WorkflowInputValidationError,
  WorkflowRunConflictError,
} from "./run-errors.js";
import { getRequiredExecutionStageIds, validateWorkflowSemantics } from "./validate-workflow.js";
import { evaluateWorkflowCondition } from "./condition.js";
import type { WorkflowDefinition, WorkflowInputDefinition } from "./types.js";
import { loadApprovalTrustStore, signApprovalDecision, verifyApprovalDecisionSignature } from "../approval-trust.js";
import type { ApprovalSigner } from "../approval-trust.js";

export interface WorkflowRunServiceOptions {
  projectRoot: string;
  projectId: string;
  clock?: () => Date;
  idFactory?: () => string;
  projectContext?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
}

export interface StageTransitionOptions {
  reason?: string;
  verification?: StageVerificationReference;
  approval?: ApprovalRecord;
}

const ACTIVE_STAGE_STATUSES = new Set<StageStatus>([
  "ready",
  "in_progress",
  "awaiting_approval",
  "verifying",
  "blocked",
]);

const ALLOWED_RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  created: ["running", "cancelled"],
  running: ["paused", "blocked", "awaiting_approval", "completed", "failed", "cancelled"],
  paused: ["running", "cancelled"],
  blocked: ["running", "awaiting_approval", "failed", "cancelled"],
  awaiting_approval: ["running", "blocked", "failed", "cancelled"],
  completed: [],
  failed: ["running", "blocked", "awaiting_approval", "cancelled"],
  cancelled: [],
};

const RUN_EVENT_TYPES = new Set([
  "run.started",
  "run.status_changed",
  "run.paused",
  "run.resumed",
  "run.completed",
  "run.cancelled",
]);

const STAGE_STATUSES: readonly StageStatus[] = [
  "pending", "ready", "in_progress", "blocked", "awaiting_approval",
  "verifying", "completed", "failed", "skipped", "stale",
];

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" &&
    ["created", "running", "paused", "blocked", "awaiting_approval", "completed", "failed", "cancelled"].includes(value);
}

function isStageStatus(value: unknown): value is StageStatus {
  return typeof value === "string" && STAGE_STATUSES.includes(value as StageStatus);
}

function assertAllowedRunTransition(from: RunStatus, to: RunStatus): void {
  if (!ALLOWED_RUN_TRANSITIONS[from].includes(to)) {
    throw new WorkflowRunConflictError(
      'Run cannot transition from "' + from + '" to "' + to + '".',
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function matchesInputType(value: unknown, type: WorkflowInputDefinition["type"]): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
  }
}

function normalizeInputs(
  definitions: WorkflowInputDefinition[],
  provided: Record<string, unknown>,
): Record<string, unknown> {
  if (!isPlainObject(provided)) {
    throw new WorkflowInputValidationError(["Inputs must be a plain object."]);
  }

  const issues: string[] = [];
  const definitionNames = new Set<string>();
  const normalized: Record<string, unknown> = {};

  for (const definition of definitions) {
    if (definitionNames.has(definition.name)) {
      issues.push('Input "' + definition.name + '" is defined more than once.');
      continue;
    }
    definitionNames.add(definition.name);

    const hasValue = Object.prototype.hasOwnProperty.call(provided, definition.name);
    const hasDefault = Object.prototype.hasOwnProperty.call(definition, "default");

    if (!hasValue && !hasDefault) {
      if (definition.required) {
        issues.push('Missing required input "' + definition.name + '".');
      }
      continue;
    }

    const value = hasValue ? provided[definition.name] : definition.default;
    if (!matchesInputType(value, definition.type)) {
      issues.push('Input "' + definition.name + '" must be of type ' + definition.type + '.');
      continue;
    }
    normalized[definition.name] = value;
  }

  for (const name of Object.keys(provided)) {
    if (!definitionNames.has(name)) {
      issues.push('Unknown input "' + name + '".');
    }
  }

  if (issues.length > 0) throw new WorkflowInputValidationError(issues);

  try {
    const serialized = JSON.stringify(normalized);
    if (serialized === undefined) throw new Error("Inputs are not JSON serializable.");
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch (error) {
    throw new WorkflowInputValidationError([
      error instanceof Error ? error.message : "Inputs are not JSON serializable.",
    ]);
  }
}

function eventActor(): WorkflowEvent["actor"] {
  return { type: "system", id: "aether" };
}

export class WorkflowRunService {
  private readonly store: FileStateStore;
  private readonly projectRoot: string;
  private readonly projectId: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly projectContext: Record<string, unknown>;
  private readonly capabilities: Record<string, unknown>;

  constructor(options: WorkflowRunServiceOptions) {
    if (!options.projectId.trim()) {
      throw new Error("WorkflowRunService requires a non-empty projectId.");
    }
    this.projectRoot = resolve(options.projectRoot);
    this.store = new FileStateStore(this.projectRoot);
    this.projectId = options.projectId;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.projectContext = { ...(options.projectContext ?? {}), id: options.projectContext?.id ?? options.projectId };
    this.capabilities = options.capabilities ?? {};
  }

  async createRun(
    workflow: WorkflowDefinition,
    providedInputs: Record<string, unknown> = {},
  ): Promise<WorkflowRunSnapshot> {
    const semanticIssues = validateWorkflowSemantics(workflow);
    if (semanticIssues.length > 0) {
      throw new WorkflowRunConflictError(
        semanticIssues.map((issue) => issue.message).join("\n"),
      );
    }
    if (workflow.completion.required_stages.length === 0) {
      throw new WorkflowRunConflictError(
        "A runnable workflow must declare at least one required completion stage.",
      );
    }

    const inputs = normalizeInputs(workflow.inputs, providedInputs);
    const timestamp = this.timestamp();
    const runId = "run_" + this.idFactory();
    const stages: Record<string, StageRunState> = {};

    for (const stage of workflow.stages) {
      stages[stage.id] = {
        stage_id: stage.id,
        status: "pending",
        attempt: 0,
        inputs: [],
        outputs: [],
        last_event_sequence: 0,
      };
    }

    const snapshot: WorkflowRunSnapshot = {
      schema_version: 1,
      id: runId,
      workflow_id: workflow.id,
      workflow_version: workflow.version,
      status: "created",
      project_id: this.projectId,
      inputs,
      stages,
      current_stage_ids: [],
      created_at: timestamp,
      updated_at: timestamp,
      last_event_sequence: 1,
      snapshot_sequence: 1,
    };

    const event = this.createEvent(
      runId,
      1,
      "run.created",
      "run",
      runId,
      timestamp,
      {
        workflow_id: workflow.id,
        workflow_version: workflow.version,
        stage_ids: workflow.stages.map((stage) => stage.id),
      },
    );

    await this.store.initializeRun(snapshot, event);
    return snapshot;
  }

  async getRun(runId: string): Promise<WorkflowRunSnapshot> {
    const loaded = await this.store.loadRun(runId);
    this.assertNoPendingEvents(runId, loaded.pendingEvents.length);
    return loaded.snapshot;
  }

  /**
   * Replays known, deterministic events that were appended but not reflected
   * in the run snapshot. Unknown events fail closed and remain in the log.
   */
  async recoverRun(
    runId: string,
    workflow: WorkflowDefinition,
  ): Promise<WorkflowRunSnapshot> {
    const semanticIssues = validateWorkflowSemantics(workflow);
    if (semanticIssues.length > 0) {
      throw new WorkflowRunConflictError(
        semanticIssues.map((issue) => issue.message).join("\n"),
      );
    }

    const loaded = await this.store.loadRun(runId);
    let snapshot = loaded.snapshot;
    if (
      snapshot.workflow_id !== workflow.id ||
      snapshot.workflow_version !== workflow.version
    ) {
      throw new WorkflowRunConflictError(
        'Run "' + runId + '" is pinned to workflow ' +
          snapshot.workflow_id + "@" + snapshot.workflow_version +
          ", not " + workflow.id + "@" + workflow.version + ".",
      );
    }

    for (const event of loaded.pendingEvents) {
      if (event.sequence !== snapshot.last_event_sequence + 1) {
        throw new StateIntegrityError(
          'Run "' + runId + '" has a non-contiguous pending event sequence.',
        );
      }
      if (!Number.isFinite(Date.parse(event.timestamp))) {
        throw new StateIntegrityError(
          'Run "' + runId + '" contains an event with an invalid timestamp.',
        );
      }

      if (event.type === "stage.transitioned") {
        if (
          event.entity.type !== "stage" ||
          event.entity.id !== event.payload.stage_id ||
          typeof event.payload.stage_id !== "string" ||
          !isStageStatus(event.payload.to)
        ) {
          throw new StateIntegrityError(
            'Run "' + runId + '" contains a malformed stage transition event.',
          );
        }

        const stageId = event.payload.stage_id;
        const definition = workflow.stages.find((stage) => stage.id === stageId);
        const currentStage = snapshot.stages[stageId];
        if (!definition || !currentStage) {
          throw new StateIntegrityError(
            'Run "' + runId + '" references unknown stage "' + stageId + '".',
          );
        }

        const targetStatus = event.payload.to;
        if (definition.condition) {
          const conditionResult = evaluateWorkflowCondition(
            definition.condition,
            this.conditionContext(snapshot),
          );
          if (targetStatus === "ready" && !conditionResult) {
            throw new StateIntegrityError(
              'Run "' + runId + '" recorded a conditional stage as ready when its condition was false.',
            );
          }
          if (targetStatus === "skipped" && conditionResult) {
            throw new StateIntegrityError(
              'Run "' + runId + '" recorded a conditional stage as skipped when its condition was true.',
            );
          }
          if (targetStatus === "skipped" && !this.dependenciesCompleted(definition, snapshot)) {
            throw new StateIntegrityError(
              'Run "' + runId + '" skipped a conditional stage before its dependencies completed.',
            );
          }
        }
        if (
          targetStatus === "ready" &&
          !this.dependenciesCompleted(definition, snapshot)
        ) {
          throw new StateIntegrityError(
            'Run "' + runId + '" recorded stage "' + stageId +
              '" as ready before its dependencies completed.',
          );
        }
        if (
          targetStatus === "skipped" &&
          (definition.required || this.requiredExecutionStageIds(workflow).has(stageId))
        ) {
          throw new StateIntegrityError(
            'Run "' + runId + '" recorded a required stage as skipped.',
          );
        }
        if (
          event.payload.reason !== undefined &&
          typeof event.payload.reason !== "string"
        ) {
          throw new StateIntegrityError(
            'Run "' + runId + '" contains a malformed stage transition reason.',
          );
        }

        let approvalId: string | undefined;
        if (targetStatus === "awaiting_approval") {
          if (!definition.approval || definition.approval.mode === "none" || (currentStage.status === "pending" && definition.approval.mode !== "required") || !this.dependenciesCompleted(definition, snapshot)) {
            throw new StateIntegrityError('Run "' + runId + '" recorded an approval request for an ineligible stage.');
          }
          if (definition.condition && !evaluateWorkflowCondition(definition.condition, this.conditionContext(snapshot))) {
            throw new StateIntegrityError('Run "' + runId + '" recorded approval for a conditional stage whose condition is false.');
          }
          approvalId = (await this.assertApprovalRecord(event.payload.approval, runId, workflow, definition, "pending")).id;
        } else if (currentStage.status === "awaiting_approval") {
          const expected = targetStatus === "ready" ? "approved" : targetStatus === "blocked" ? "rejected" : undefined;
          if (!expected) throw new StateIntegrityError('Run "' + runId + '" moved a stage out of awaiting_approval without a decision.');
          const decision = await this.assertApprovalRecord(event.payload.approval, runId, workflow, definition, expected);
          if (decision.id !== currentStage.approval_id) throw new StateIntegrityError("Approval decision does not match the pending stage approval.");
          approvalId = decision.id;
        } else if (targetStatus === "ready" && currentStage.approval_id) {
          throw new StateIntegrityError('Run "' + runId + '" returned a previously gated stage to ready without a new approval.');
        } else if (event.payload.approval !== undefined) {
          throw new StateIntegrityError('Run "' + runId + '" contains an unexpected approval record on a stage transition.');
        }
        const nextStage = transitionStageState(currentStage, {
          to: targetStatus,
          event_sequence: event.sequence,
          timestamp: event.timestamp,
          ...(typeof event.payload.reason === "string" ? { reason: event.payload.reason } : {}),
          ...(approvalId === undefined ? {} : { approval_id: approvalId }),
        });
        if (targetStatus === "completed") {
          const verification = event.payload.verification as StageVerificationReference | undefined;
          if (!verification) {
            throw new StateIntegrityError(
              'Run "' + runId + '" contains a completion event without verification evidence.',
            );
          }
          await this.assertVerificationManifest(runId, stageId, definition, verification);
          nextStage.verification = verification;
        }
        const stages = { ...snapshot.stages, [stageId]: nextStage };
        snapshot = {
          ...snapshot,
          stages,
          current_stage_ids: this.currentStageIds(stages),
          last_event_sequence: event.sequence,
          snapshot_sequence: event.sequence,
          updated_at: event.timestamp,
        };
        continue;
      }

      if (RUN_EVENT_TYPES.has(event.type)) {
        if (
          event.entity.type !== "run" ||
          event.entity.id !== runId ||
          event.payload.from !== snapshot.status ||
          !isRunStatus(event.payload.to)
        ) {
          throw new StateIntegrityError(
            'Run "' + runId + '" contains a malformed run status event.',
          );
        }

        const nextStatus = event.payload.to;
        const expectedStatusByEvent: Record<string, RunStatus> = {
          "run.started": "running",
          "run.paused": "paused",
          "run.resumed": "running",
          "run.completed": "completed",
          "run.cancelled": "cancelled",
        };
        const expectedStatus = expectedStatusByEvent[event.type];
        if (expectedStatus !== undefined && nextStatus !== expectedStatus) {
          throw new StateIntegrityError(
            'Run "' + runId + '" event "' + event.type +
              '" has an invalid target status.',
          );
        }

        assertAllowedRunTransition(snapshot.status, nextStatus);
        snapshot = {
          ...snapshot,
          status: nextStatus,
          current_stage_ids: nextStatus === "cancelled" ? [] : snapshot.current_stage_ids,
          last_event_sequence: event.sequence,
          snapshot_sequence: event.sequence,
          updated_at: event.timestamp,
        };
        continue;
      }

      throw new StateIntegrityError(
        'Run "' + runId + '" contains unsupported event type "' + event.type +
          '". Recovery stopped without discarding the event.',
      );
    }

    if (loaded.pendingEvents.length > 0) {
      await this.store.writeSnapshot(snapshot);
    }

    // A crash may occur after run.started was logged but before its root
    // stages were promoted. Also refresh aggregate status when a stage
    // approval decision was replayed but its run.status_changed event was not.
    if (snapshot.status === "running") {
      snapshot = await this.promoteReadyStages(snapshot, workflow);
      snapshot = await this.refreshRunStatus(snapshot, workflow);
    } else if (["awaiting_approval", "blocked", "failed"].includes(snapshot.status)) {
      snapshot = await this.refreshRunStatus(snapshot, workflow);
    }

    return snapshot;
  }

  async pauseRun(runId: string): Promise<WorkflowRunSnapshot> {
    const snapshot = await this.getRun(runId);
    if (snapshot.status !== "running") {
      throw new WorkflowRunConflictError(
        'Run "' + runId + '" can only be paused while running.',
      );
    }
    return this.commitRunStatus(
      snapshot,
      "paused",
      "run.paused",
      this.timestamp(),
    );
  }

  async resumeRun(
    runId: string,
    workflow: WorkflowDefinition,
  ): Promise<WorkflowRunSnapshot> {
    let snapshot = await this.recoverRun(runId, workflow);
    if (snapshot.status !== "paused") {
      throw new WorkflowRunConflictError(
        'Run "' + runId + '" can only be resumed while paused; current status is "' +
          snapshot.status + '".',
      );
    }

    snapshot = await this.commitRunStatus(
      snapshot,
      "running",
      "run.resumed",
      this.timestamp(),
    );
    snapshot = await this.promoteReadyStages(snapshot, workflow);
    return this.refreshRunStatus(snapshot, workflow);
  }

  async cancelRun(runId: string): Promise<WorkflowRunSnapshot> {
    const snapshot = await this.getRun(runId);
    if (snapshot.status === "completed" || snapshot.status === "cancelled") {
      throw new WorkflowRunConflictError(
        'Run "' + runId + '" is already terminal and cannot be cancelled.',
      );
    }
    return this.commitRunStatus(
      snapshot,
      "cancelled",
      "run.cancelled",
      this.timestamp(),
    );
  }

  async startRun(
    runId: string,
    workflow: WorkflowDefinition,
  ): Promise<WorkflowRunSnapshot> {
    let snapshot = await this.loadConsistentRun(runId, workflow);
    if (snapshot.status !== "created") {
      throw new WorkflowRunConflictError(
        'Run "' + runId + '" cannot start from status "' + snapshot.status + '".',
      );
    }

    const timestamp = this.timestamp();
    snapshot = await this.commitRunStatus(snapshot, "running", "run.started", timestamp);
    snapshot = await this.promoteReadyStages(snapshot, workflow);
    return this.refreshRunStatus(snapshot, workflow);
  }

  async requestStageApproval(runId: string, workflow: WorkflowDefinition, stageId: string, requestedBy: string): Promise<WorkflowRunSnapshot> {
    const requester = requestedBy.trim();
    if (!requester) throw new WorkflowRunConflictError("An approval requester identity is required.");
    const snapshot = await this.loadConsistentRun(runId, workflow);
    const definition = workflow.stages.find((stage) => stage.id === stageId);
    const stage = snapshot.stages[stageId];
    if (!definition || !stage) throw new WorkflowRunConflictError('Stage "' + stageId + '" does not belong to workflow "' + workflow.id + '".');
    if (!definition.approval || definition.approval.mode === "none") throw new WorkflowRunConflictError('Stage "' + stageId + '" does not support approval requests.');
    if (!["ready", "blocked", "failed"].includes(stage.status)) throw new WorkflowRunConflictError('Stage "' + stageId + '" cannot request approval from status "' + stage.status + '".');
    if (!this.dependenciesCompleted(definition, snapshot)) throw new WorkflowRunConflictError('Stage "' + stageId + '" cannot request approval before its dependencies complete.');
    if (definition.condition && !evaluateWorkflowCondition(definition.condition, this.conditionContext(snapshot))) {
      throw new WorkflowRunConflictError('Conditional stage "' + stageId + '" cannot request approval when its condition is false.');
    }
    const approval = this.createStageApproval(runId, workflow, definition, requester, this.timestamp());
    return this.transitionStage(runId, workflow, stageId, "awaiting_approval", { approval });
  }

  async approveStage(runId: string, workflow: WorkflowDefinition, stageId: string, decidedBy: string, reason?: string, signer?: ApprovalSigner): Promise<WorkflowRunSnapshot> {
    const approver = decidedBy.trim();
    if (!approver) throw new WorkflowRunConflictError("An approval decision identity is required.");
    const snapshot = await this.loadConsistentRun(runId, workflow);
    const definition = workflow.stages.find((stage) => stage.id === stageId);
    const stage = snapshot.stages[stageId];
    if (!definition || !stage) throw new WorkflowRunConflictError('Stage "' + stageId + '" does not belong to workflow "' + workflow.id + '".');
    if (stage.status !== "awaiting_approval" || !stage.approval_id) throw new WorkflowRunConflictError('Stage "' + stageId + '" is not awaiting an approval decision.');
    const stored = await this.loadStageApproval(runId, stageId, stage.approval_id);
    const pending = await this.assertApprovalRecord(stored, runId, workflow, definition, "pending");
    const timestamp = this.timestamp();
    if (pending.expires_at && Date.parse(pending.expires_at) <= Date.parse(timestamp)) {
      throw new WorkflowRunConflictError('Approval "' + pending.id + '" has expired and cannot be approved.');
    }
    const approval = await this.createApprovalDecision(pending, definition, "approved", approver, timestamp, reason, signer);
    return this.transitionStage(runId, workflow, stageId, "ready", { approval });
  }

  async rejectStage(runId: string, workflow: WorkflowDefinition, stageId: string, decidedBy: string, reason: string, signer?: ApprovalSigner): Promise<WorkflowRunSnapshot> {
    const approver = decidedBy.trim();
    const decisionReason = reason.trim();
    if (!approver || !decisionReason) throw new WorkflowRunConflictError("A rejection requires both a decision identity and a non-empty reason.");
    const snapshot = await this.loadConsistentRun(runId, workflow);
    const definition = workflow.stages.find((stage) => stage.id === stageId);
    const stage = snapshot.stages[stageId];
    if (!definition || !stage) throw new WorkflowRunConflictError('Stage "' + stageId + '" does not belong to workflow "' + workflow.id + '".');
    if (stage.status !== "awaiting_approval" || !stage.approval_id) throw new WorkflowRunConflictError('Stage "' + stageId + '" is not awaiting an approval decision.');
    const stored = await this.loadStageApproval(runId, stageId, stage.approval_id);
    const pending = await this.assertApprovalRecord(stored, runId, workflow, definition, "pending");
    const approval = await this.createApprovalDecision(pending, definition, "rejected", approver, this.timestamp(), decisionReason, signer);
    return this.transitionStage(runId, workflow, stageId, "blocked", { reason: decisionReason, approval });
  }
  async transitionStage(
    runId: string,
    workflow: WorkflowDefinition,
    stageId: string,
    to: StageStatus,
    options: StageTransitionOptions = {},
  ): Promise<WorkflowRunSnapshot> {
    let snapshot = await this.loadConsistentRun(runId, workflow);
    if (["created", "paused", "completed", "cancelled"].includes(snapshot.status)) {
      throw new WorkflowRunConflictError(
        'Run "' + runId + '" cannot change stage state while status is "' + snapshot.status + '".',
      );
    }

    const stageDefinition = workflow.stages.find((stage) => stage.id === stageId);
    const currentStage = snapshot.stages[stageId];
    if (!stageDefinition || !currentStage) {
      throw new WorkflowRunConflictError(
        'Stage "' + stageId + '" does not belong to workflow "' + workflow.id + '".',
      );
    }
    if (to === "awaiting_approval") {
      if (!stageDefinition.approval || stageDefinition.approval.mode === "none") throw new WorkflowRunConflictError('Stage "' + stageId + '" does not define an approval gate.');
      if (currentStage.status === "pending" && stageDefinition.approval.mode !== "required") throw new WorkflowRunConflictError("A pending stage may enter approval only when its approval mode is required.");
      if (!this.dependenciesCompleted(stageDefinition, snapshot)) throw new WorkflowRunConflictError('Stage "' + stageId + '" cannot await approval before its dependencies complete.');
      if (stageDefinition.condition && !evaluateWorkflowCondition(stageDefinition.condition, this.conditionContext(snapshot))) {
        throw new WorkflowRunConflictError('Conditional stage "' + stageId + '" cannot await approval when its condition is false.');
      }
      if (!options.approval) throw new WorkflowRunConflictError("An approval record is required to enter awaiting_approval.");
      await this.assertApprovalRecord(options.approval, runId, workflow, stageDefinition, "pending");
    }

    if (currentStage.status === "awaiting_approval") {
      const expected = to === "ready" ? "approved" : to === "blocked" ? "rejected" : undefined;
      if (!expected) throw new WorkflowRunConflictError('Stage "' + stageId + '" must receive an approval decision before leaving awaiting_approval.');
      if (!options.approval || options.approval.id !== currentStage.approval_id) {
        throw new WorkflowRunConflictError("A matching approval decision is required to leave awaiting_approval.");
      }
      const decision = await this.assertApprovalRecord(options.approval, runId, workflow, stageDefinition, expected);
      if (decision.id !== currentStage.approval_id) throw new WorkflowRunConflictError("Approval decision does not match the pending stage approval.");
    }

    if (to === "ready" && currentStage.approval_id && currentStage.status !== "awaiting_approval") {
      throw new WorkflowRunConflictError("A fresh approval request is required before this stage can become ready again.");
    }
    if (to === "ready" && stageDefinition.approval?.mode === "required" && currentStage.status !== "awaiting_approval") {
      throw new WorkflowRunConflictError('Stage "' + stageId + '" requires a new approval before it can become ready.');
    }

    if (to === "ready" && !this.dependenciesCompleted(stageDefinition, snapshot)) {
      throw new WorkflowRunConflictError(
        'Stage "' + stageId + '" cannot become ready until all dependencies are completed.',
      );
    }
    if (to === "skipped" && this.requiredExecutionStageIds(workflow).has(stageId)) {
      throw new WorkflowRunConflictError(
        'Stage "' + stageId + '" is required by a completion path and cannot be skipped.',
      );
    }
    if (to === "skipped" && stageDefinition.required) {
      throw new WorkflowRunConflictError(
        'Required stage "' + stageId + '" cannot be skipped.',
      );
    }
    if (to === "skipped" && stageDefinition.condition) {
      if (!this.dependenciesCompleted(stageDefinition, snapshot)) {
        throw new WorkflowRunConflictError(
          'Conditional stage "' + stageId + '" cannot be skipped before its dependencies complete.',
        );
      }
      if (evaluateWorkflowCondition(stageDefinition.condition, this.conditionContext(snapshot))) {
        throw new WorkflowRunConflictError(
          'Conditional stage "' + stageId + '" evaluated true and cannot be skipped.',
        );
      }
    }
    if (to === "ready" && stageDefinition.condition &&
        !evaluateWorkflowCondition(stageDefinition.condition, this.conditionContext(snapshot))) {
      throw new WorkflowRunConflictError(
        'Conditional stage "' + stageId + '" evaluated false and cannot become ready.',
      );
    }

    if (to === "completed") {
      const verification = options.verification ?? currentStage.verification;
      if (!verification) {
        throw new WorkflowRunConflictError(
          'Stage "' + stageId + '" cannot complete without a verified evidence manifest.',
        );
      }
      await this.assertVerificationManifest(runId, stageId, stageDefinition, verification);
    }

    const timestamp = this.timestamp();
    const nextStage = transitionStageState(currentStage, {
      to,
      event_sequence: snapshot.last_event_sequence + 1,
      timestamp,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      ...(options.approval === undefined ? {} : { approval_id: options.approval.id }),
    });

    const payload: Record<string, unknown> = { stage_id: stageId, to };
    if (options.reason !== undefined) payload.reason = options.reason;
    if (options.approval !== undefined) payload.approval = options.approval;
    if (to === "completed") {
      const verification = options.verification ?? currentStage.verification!;
      nextStage.verification = verification;
      payload.verification = verification;
    }

    snapshot = await this.commitStageState(
      snapshot,
      nextStage,
      "stage.transitioned",
      payload,
      timestamp,
    );

    if (to === "completed") {
      snapshot = await this.promoteReadyStages(snapshot, workflow);
    }

    return this.refreshRunStatus(snapshot, workflow);
  }

  private async createApprovalDecision(
    pending: ApprovalRecord,
    definition: WorkflowDefinition["stages"][number],
    status: "approved" | "rejected",
    decidedBy: string,
    decidedAt: string,
    reason: string | undefined,
    signer: ApprovalSigner | undefined,
  ): Promise<ApprovalRecord> {
    const approval: ApprovalRecord = {
      ...pending,
      status,
      decided_at: decidedAt,
      decided_by: decidedBy,
      ...(reason?.trim() ? { decision_reason: reason.trim() } : {}),
    };
    const policy = definition.approval;
    if (policy?.require_signature && !signer) {
      throw new WorkflowRunConflictError("This stage requires a cryptographically signed approval decision; provide --key.");
    }
    if (signer) {
      try {
        const trustStore = await loadApprovalTrustStore(this.projectRoot);
        signApprovalDecision(approval, signer, trustStore, policy);
      } catch (error) {
        throw new WorkflowRunConflictError(error instanceof Error ? error.message : "Approval authorization failed.");
      }
    }
    return approval;
  }
  private createStageApproval(runId: string, workflow: WorkflowDefinition, definition: WorkflowDefinition["stages"][number], requestedBy: string, timestamp: string): ApprovalRecord {
    const context = {
      run_id: runId, workflow_id: workflow.id, workflow_version: workflow.version, stage_id: definition.id,
      scope: { read_paths: definition.scope?.read_paths ?? [], write_paths: definition.scope?.write_paths ?? [] },
      acceptance_criteria: definition.acceptance_criteria ?? [],
    };
    const action = {
      id: "stage-" + runId + "-" + definition.id,
      type: "workflow.stage.execute",
      target: definition.id,
      risk: definition.approval?.risk ?? "medium",
      requested_by: requestedBy, context,
    };
    return {
      schema_version: 1,
      id: "approval_" + this.idFactory(),
      action,
      status: "pending",
      requested_at: timestamp, requested_by: requestedBy,
      policy_version: "aether-approval-v1",
      action_digest: createHash("sha256").update(JSON.stringify(action), "utf8").digest("hex"),
    };
  }

  private async assertApprovalRecord(value: unknown, runId: string, workflow: WorkflowDefinition, definition: WorkflowDefinition["stages"][number], expectedStatus: ApprovalRecord["status"]): Promise<ApprovalRecord> {
    const invalid = (message: string): never => { throw new StateIntegrityError("Invalid approval record: " + message); };
    if (!isPlainObject(value)) invalid("record must be an object.");
    const record = value as unknown as ApprovalRecord;
    if (record.schema_version !== 1 || typeof record.id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(record.id) || record.status !== expectedStatus ||
        record.policy_version !== "aether-approval-v1" || typeof record.requested_by !== "string" || !record.requested_by.trim() ||
        typeof record.requested_at !== "string" || !Number.isFinite(Date.parse(record.requested_at)) ||
        typeof record.action_digest !== "string" || !/^[a-f0-9]{64}$/.test(record.action_digest)) {
      invalid("metadata, status, requester, timestamp, or digest is malformed.");
    }
    if (!isPlainObject(record.action) || !isPlainObject(record.action.context)) invalid("action and context must be plain objects.");
    const expectedContext = {
      run_id: runId, workflow_id: workflow.id, workflow_version: workflow.version, stage_id: definition.id,
      scope: { read_paths: definition.scope?.read_paths ?? [], write_paths: definition.scope?.write_paths ?? [] },
      acceptance_criteria: definition.acceptance_criteria ?? [],
    };
    const risk = definition.approval?.risk ?? "medium";
    if (record.action.id !== "stage-" + runId + "-" + definition.id || record.action.type !== "workflow.stage.execute" ||
        record.action.target !== definition.id || record.action.risk !== risk || record.action.requested_by !== record.requested_by ||
        JSON.stringify(record.action.context) !== JSON.stringify(expectedContext)) {
      invalid("action does not match this run, workflow, stage, scope, or acceptance criteria.");
    }
    const digest = createHash("sha256").update(JSON.stringify(record.action), "utf8").digest("hex");
    if (digest !== record.action_digest) invalid("action digest does not match the recorded action.");
    if (record.expires_at !== undefined && (typeof record.expires_at !== "string" || !Number.isFinite(Date.parse(record.expires_at)))) invalid("expiry timestamp is malformed.");
    if (expectedStatus === "pending") {
      if (record.decided_at !== undefined || record.decided_by !== undefined || record.decision_reason !== undefined || record.decision_signature !== undefined) invalid("a pending approval cannot contain a decision or signature.");
    } else {
      if (typeof record.decided_at !== "string" || !Number.isFinite(Date.parse(record.decided_at)) || typeof record.decided_by !== "string" || !record.decided_by.trim()) {
        invalid("a decision requires a valid timestamp and decision identity.");
      }
      if (expectedStatus === "rejected" && (typeof record.decision_reason !== "string" || !record.decision_reason.trim())) invalid("a rejection requires a non-empty reason.");
      const requiresSignature = definition.approval?.require_signature === true;
      if (requiresSignature || record.decision_signature !== undefined) {
        const trustStore = await loadApprovalTrustStore(this.projectRoot);
        verifyApprovalDecisionSignature(record, trustStore, requiresSignature, definition.approval);
      }
    }
    return record;
  }

  private async loadStageApproval(runId: string, stageId: string, approvalId: string): Promise<ApprovalRecord> {
    const events = await this.store.readEvents(runId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]!;
      if (event.type === "stage.transitioned" && event.entity.type === "stage" && event.entity.id === stageId &&
          isPlainObject(event.payload.approval) && event.payload.approval.id === approvalId) {
        return event.payload.approval as unknown as ApprovalRecord;
      }
    }
    throw new WorkflowRunConflictError('Approval "' + approvalId + '" for stage "' + stageId + '" was not found in the event history.');
  }
  /**
   * Re-checks a persisted verification manifest at the trust boundary.
   * A caller cannot complete a stage by constructing a "passed" object:
   * the manifest must exist inside the project, match its SHA-256 reference,
   * identify this exact run and stage, and still point at unchanged evidence.
   */
  private async assertVerificationManifest(
    runId: string,
    stageId: string,
    definition: WorkflowDefinition["stages"][number],
    verification: StageVerificationReference,
  ): Promise<void> {
    const invalid = (message: string): never => {
      throw new WorkflowRunConflictError(
        'Verification for stage "' + stageId + '" is invalid: ' + message,
      );
    };

    if (
      typeof verification.path !== "string" ||
      verification.path !== ".aether/verification/" + runId + "/" + stageId + ".json" ||
      typeof verification.artifact_id !== "string" ||
      verification.artifact_id !== "verification-" + runId + "-" + stageId ||
      verification.status !== "passed" ||
      !Number.isSafeInteger(verification.evidence_count) ||
      verification.evidence_count < 1 ||
      typeof verification.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(verification.sha256) ||
      typeof verification.verified_at !== "string" ||
      !Number.isFinite(Date.parse(verification.verified_at))
    ) {
      invalid("verification reference is malformed.");
    }

    const root = await realpath(this.projectRoot);
    const safeProjectPath = async (path: string, label: string): Promise<string> => {
      if (
        typeof path !== "string" ||
        path.length === 0 ||
        path.includes(String.fromCharCode(92)) ||
        isAbsolute(path) ||
        /^[A-Za-z]:/.test(path) ||
        path.split("/").some((part) => part === "" || part === "." || part === "..")
      ) {
        invalid(label + " is not a safe relative project path.");
      }

      let current = root;
      const segments = path.split("/");
      for (const [index, segment] of segments.entries()) {
        current = resolve(current, segment);
        const details = await lstat(current).catch(() => invalid(label + " does not exist."));
        if (details.isSymbolicLink()) {
          invalid(label + " must not traverse symbolic links.");
        }
        const isLast = index === segments.length - 1;
        if (!isLast && !details.isDirectory()) {
          invalid(label + " contains a non-directory path component.");
        }
        if (isLast && !details.isFile()) {
          invalid(label + " is not a regular file.");
        }
      }
      const actual = await realpath(current).catch(() => invalid(label + " does not exist."));
      const rel = relative(root, actual);
      if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
        invalid(label + " resolves outside the project root.");
      }
      const finalDetails = await lstat(actual);
      if (finalDetails.isSymbolicLink() || !finalDetails.isFile()) {
        invalid(label + " is not a regular file.");
      }
      return actual;
    };

    const manifestPath = await safeProjectPath(verification.path, "manifest");
    const manifestStats = await stat(manifestPath);
    if (!manifestStats.isFile()) invalid("manifest is not a regular file.");

    const manifestBytes = await readFile(manifestPath);
    const manifestDigest = createHash("sha256").update(manifestBytes).digest("hex");
    if (manifestDigest !== verification.sha256) {
      invalid("manifest checksum does not match.");
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestBytes.toString("utf8")) as unknown;
    } catch {
      invalid("manifest contains invalid JSON.");
    }

    if (
      typeof manifest !== "object" ||
      manifest === null ||
      !("schema_version" in manifest) ||
      manifest.schema_version !== 1 ||
      !("run_id" in manifest) ||
      manifest.run_id !== runId ||
      !("stage_id" in manifest) ||
      manifest.stage_id !== stageId ||
      !("task_id" in manifest) ||
      typeof manifest.task_id !== "string" ||
      manifest.task_id !== "task_" + runId + "_" + stageId ||
      !("summary" in manifest) ||
      typeof manifest.summary !== "string" ||
      !manifest.summary.trim() ||
      !("changed_files" in manifest) ||
      !Array.isArray(manifest.changed_files) ||
      !("evidence" in manifest) ||
      !Array.isArray(manifest.evidence) ||
      manifest.evidence.length !== verification.evidence_count ||
      !("verified_at" in manifest) ||
      manifest.verified_at !== verification.verified_at
    ) {
      invalid("manifest identity or required fields do not match.");
    }

    const isWithinScope = (path: string, patterns: string[]): boolean =>
      patterns.some((pattern) => {
        if (pattern === "**" || pattern === "**/*") return true;
        if (pattern.endsWith("/**")) {
          const prefix = pattern.slice(0, -3);
          return path === prefix || path.startsWith(prefix + "/");
        }
        return path === pattern;
      });

    // Narrow the parsed JSON only after the runtime shape checks above pass.
    const validatedManifest = manifest as {
      changed_files: unknown[];
      evidence: unknown[];
    };

    const writePaths = definition.scope?.write_paths ?? [];
    const seenChangedFiles = new Set<string>();
    for (const rawChangedFile of validatedManifest.changed_files) {
      if (typeof rawChangedFile !== "object" || rawChangedFile === null) {
        invalid("changed file record must be an object.");
      }
      const changedRecord = rawChangedFile as Record<string, unknown>;
      const changedPath =
        typeof changedRecord.path === "string"
          ? changedRecord.path
          : invalid("changed file path must be a string.");
      const changedSha =
        typeof changedRecord.sha256 === "string"
          ? changedRecord.sha256
          : invalid("changed file checksum must be a string.");
      const changedSize =
        typeof changedRecord.size_bytes === "number"
          ? changedRecord.size_bytes
          : invalid("changed file size must be a number.");
      if (
        !/^[a-f0-9]{64}$/.test(changedSha) ||
        !Number.isSafeInteger(changedSize) ||
        changedSize < 0 ||
        seenChangedFiles.has(changedPath)
      ) {
        invalid("changed file record is malformed or duplicated.");
      }
      seenChangedFiles.add(changedPath);
      if (!isWithinScope(changedPath, writePaths)) {
        invalid("changed file is outside the declared write scope.");
      }
      const changedAbsolute = await safeProjectPath(changedPath, "changed file");
      const changedStats = await stat(changedAbsolute);
      if (!changedStats.isFile()) {
        invalid("changed file size or type has changed.");
      }
      const changedBytes = await readFile(changedAbsolute);
      if (changedBytes.length !== changedSize) {
        invalid("changed file size or type has changed.");
      }
      const changedDigest = createHash("sha256")
        .update(changedBytes)
        .digest("hex");
      if (changedDigest !== changedSha) {
        invalid("changed file checksum no longer matches.");
      }
    }

    const outputScope = [
      ".aether/handoffs/" + runId + "/" + stageId + "/output/**",
    ];
    const allowedEvidenceTypes = [
      "test_report", "build_log", "screenshot", "trace", "review_record",
      "security_scan", "design_artifact", "documentation", "other",
    ];

    let hasPassingEvidence = false;
    for (const rawEvidence of validatedManifest.evidence) {
      if (typeof rawEvidence !== "object" || rawEvidence === null) {
        invalid("evidence record must be an object.");
      }
      const record = rawEvidence as Record<string, unknown>;
      const evidencePath =
        typeof record.path === "string"
          ? record.path
          : invalid("evidence path must be a string.");
      const evidenceSha =
        typeof record.sha256 === "string"
          ? record.sha256
          : invalid("evidence checksum must be a string.");
      const evidenceSize =
        typeof record.size_bytes === "number"
          ? record.size_bytes
          : invalid("evidence size must be a number.");
      const evidenceResult =
        record.result === "passed" || record.result === "informational"
          ? record.result
          : invalid("evidence result is invalid.");
      const evidenceType =
        typeof record.type === "string"
          ? record.type
          : invalid("evidence type must be a string.");

      if (
        !/^[a-f0-9]{64}$/.test(evidenceSha) ||
        !allowedEvidenceTypes.includes(evidenceType) ||
        !isWithinScope(evidencePath, outputScope) ||
        !Number.isSafeInteger(evidenceSize) ||
        evidenceSize < 1
      ) {
        invalid("evidence record is malformed.");
      }

      if (evidenceResult === "passed") hasPassingEvidence = true;
      const evidenceAbsolute = await safeProjectPath(evidencePath, "evidence file");
      const evidenceStats = await stat(evidenceAbsolute);
      if (!evidenceStats.isFile() || evidenceStats.size !== evidenceSize) {
        invalid("evidence file size or type has changed.");
      }
      const evidenceDigest = createHash("sha256")
        .update(await readFile(evidenceAbsolute))
        .digest("hex");
      if (evidenceDigest !== evidenceSha) {
        invalid("evidence checksum no longer matches.");
      }
    }
    if (!hasPassingEvidence) invalid("at least one evidence record must report a passed result.");
  }

  private async loadConsistentRun(
    runId: string,
    workflow: WorkflowDefinition,
  ): Promise<WorkflowRunSnapshot> {
    if (workflow.id.trim().length === 0 || workflow.version < 1) {
      throw new WorkflowRunConflictError("Invalid workflow identity or version.");
    }
    const loaded = await this.store.loadRun(runId);
    this.assertNoPendingEvents(runId, loaded.pendingEvents.length);

    if (
      loaded.snapshot.workflow_id !== workflow.id ||
      loaded.snapshot.workflow_version !== workflow.version
    ) {
      throw new WorkflowRunConflictError(
        'Run "' + runId + '" is pinned to workflow ' + loaded.snapshot.workflow_id + "@" + loaded.snapshot.workflow_version + ", not " + workflow.id + "@" + workflow.version + ".",
      );
    }
    return loaded.snapshot;
  }

  private assertNoPendingEvents(runId: string, pendingEventCount: number): void {
    if (pendingEventCount > 0) {
      throw new RunRecoveryRequiredError(runId, pendingEventCount);
    }
  }

  private async promoteReadyStages(
    initial: WorkflowRunSnapshot,
    workflow: WorkflowDefinition,
  ): Promise<WorkflowRunSnapshot> {
    let snapshot = initial;
    const executionScope = this.executionStageIds(workflow);

    for (const definition of workflow.stages) {
      if (!executionScope.has(definition.id)) continue;
      const stage = snapshot.stages[definition.id];
      if (!stage || stage.status !== "pending") continue;
      if (!this.dependenciesCompleted(definition, snapshot)) continue;

      const conditionPassed = definition.condition
        ? evaluateWorkflowCondition(definition.condition, this.conditionContext(snapshot))
        : true;
      const timestamp = this.timestamp();
      const approval = conditionPassed && definition.approval?.mode === "required"
        ? this.createStageApproval(snapshot.id, workflow, definition, "system", timestamp)
        : undefined;
      const targetStatus: StageStatus = !conditionPassed ? "skipped" : approval ? "awaiting_approval" : "ready";
      const next = transitionStageState(stage, {
        to: targetStatus,
        event_sequence: snapshot.last_event_sequence + 1,
        timestamp,
        ...(!conditionPassed ? { reason: "Condition evaluated to false." } : {}),
        ...(approval === undefined ? {} : { approval_id: approval.id }),
      });
      const payload: Record<string, unknown> = {
        stage_id: definition.id,
        to: targetStatus,
      };
      if (!conditionPassed) payload.reason = "Condition evaluated to false.";
      if (approval !== undefined) payload.approval = approval;

      snapshot = await this.commitStageState(
        snapshot,
        next,
        "stage.transitioned",
        payload,
        timestamp,
      );
    }

    return snapshot;
  }

  /**
   * Returns the transitive dependency closure of required completion stages.
   * Optional stages outside this set remain dormant unless a later workflow
   * feature explicitly selects them.
   */
  private requiredExecutionStageIds(workflow: WorkflowDefinition): Set<string> {
    return getRequiredExecutionStageIds(workflow);
  }

  private executionStageIds(workflow: WorkflowDefinition): Set<string> {
    const execution = this.requiredExecutionStageIds(workflow);
    for (const stage of workflow.stages) {
      if (stage.condition) execution.add(stage.id);
    }
    return execution;
  }

  private conditionContext(snapshot: WorkflowRunSnapshot) {
    return {
      inputs: snapshot.inputs,
      project: this.projectContext,
      capabilities: this.capabilities,
      stages: snapshot.stages,
    };
  }

  private dependenciesCompleted(
    definition: WorkflowDefinition["stages"][number],
    snapshot: WorkflowRunSnapshot,
  ): boolean {
    return (definition.depends_on ?? []).every(
      (dependency) => snapshot.stages[dependency]?.status === "completed",
    );
  }

  private async commitStageState(
    current: WorkflowRunSnapshot,
    stage: StageRunState,
    eventType: string,
    payload: Record<string, unknown>,
    timestamp: string,
  ): Promise<WorkflowRunSnapshot> {
    const sequence = current.last_event_sequence + 1;
    if (stage.last_event_sequence !== sequence) {
      throw new WorkflowRunConflictError(
        "Stage state and next event sequence are inconsistent.",
      );
    }

    const stages = { ...current.stages, [stage.stage_id]: stage };
    const next: WorkflowRunSnapshot = {
      ...current,
      stages,
      last_event_sequence: sequence,
      snapshot_sequence: sequence,
      current_stage_ids: this.currentStageIds(stages),
      updated_at: timestamp,
    };
    const event = this.createEvent(
      current.id,
      sequence,
      eventType,
      "stage",
      stage.stage_id,
      timestamp,
      payload,
    );

    await this.store.commitEventAndSnapshot(current.id, event, next);
    return next;
  }

  private async commitRunStatus(
    current: WorkflowRunSnapshot,
    status: RunStatus,
    eventType: string,
    timestamp: string,
  ): Promise<WorkflowRunSnapshot> {
    if (current.status === status) return current;
    assertAllowedRunTransition(current.status, status);

    const sequence = current.last_event_sequence + 1;
    const next: WorkflowRunSnapshot = {
      ...current,
      status,
      current_stage_ids: status === "cancelled" ? [] : current.current_stage_ids,
      last_event_sequence: sequence,
      snapshot_sequence: sequence,
      updated_at: timestamp,
    };
    const event = this.createEvent(
      current.id,
      sequence,
      eventType,
      "run",
      current.id,
      timestamp,
      { from: current.status, to: status },
    );

    await this.store.commitEventAndSnapshot(current.id, event, next);
    return next;
  }

  private async refreshRunStatus(
    snapshot: WorkflowRunSnapshot,
    workflow: WorkflowDefinition,
  ): Promise<WorkflowRunSnapshot> {
    const requiredStatuses = workflow.completion.required_stages.map(
      (stageId) => snapshot.stages[stageId]?.status,
    );
    const executionScope = this.executionStageIds(workflow);
    const executionStages = [...executionScope]
      .map((stageId) => snapshot.stages[stageId])
      .filter((stage): stage is StageRunState => stage !== undefined);

    const conditionalStatuses = workflow.stages
      .filter((stage) => stage.condition)
      .map((stage) => snapshot.stages[stage.id]?.status);
    const requiredStagesCompleted = requiredStatuses.every(
      (stageStatus) => stageStatus === "completed",
    );
    const conditionalStagesResolved = conditionalStatuses.every(
      (stageStatus) => stageStatus === "completed" || stageStatus === "skipped",
    );

    let status: RunStatus = "running";
    if (requiredStagesCompleted && conditionalStagesResolved) {
      status = "completed";
    } else if (executionStages.some((stage) => stage.status === "awaiting_approval")) {
      status = "awaiting_approval";
    } else if (executionStages.some((stage) => stage.status === "blocked")) {
      status = "blocked";
    } else if (executionStages.some((stage) => stage.status === "failed")) {
      status = "failed";
    }

    return this.commitRunStatus(
      snapshot,
      status,
      status === "completed" ? "run.completed" : "run.status_changed",
      this.timestamp(),
    );
  }

  private currentStageIds(stages: Record<string, StageRunState>): string[] {
    return Object.values(stages)
      .filter((stage) => ACTIVE_STAGE_STATUSES.has(stage.status))
      .map((stage) => stage.stage_id);
  }

  private createEvent(
    runId: string,
    sequence: number,
    type: string,
    entityType: string,
    entityId: string,
    timestamp: string,
    payload: Record<string, unknown>,
  ): WorkflowEvent {
    return {
      schema_version: 1,
      event_id: "event_" + this.idFactory(),
      run_id: runId,
      sequence,
      type,
      timestamp,
      actor: eventActor(),
      entity: { type: entityType, id: entityId },
      payload,
    };
  }

  private timestamp(): string {
    const date = this.clock();
    if (!Number.isFinite(date.getTime())) {
      throw new Error("WorkflowRunService clock returned an invalid date.");
    }
    return date.toISOString();
  }
}
