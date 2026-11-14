import { randomUUID } from "node:crypto";
import { FileStateStore } from "../state/file-state-store.js";
import type {
  RunStatus,
  StageRunState,
  StageStatus,
  WorkflowEvent,
  WorkflowRunSnapshot,
} from "../state/types.js";
import { transitionStageState } from "../state/stage-transitions.js";
import {
  RunRecoveryRequiredError,
  WorkflowInputValidationError,
  WorkflowRunConflictError,
} from "./run-errors.js";
import { validateWorkflowSemantics } from "./validate-workflow.js";
import type { WorkflowDefinition, WorkflowInputDefinition } from "./types.js";

export interface WorkflowRunServiceOptions {
  projectRoot: string;
  projectId: string;
  clock?: () => Date;
  idFactory?: () => string;
}

export interface StageTransitionOptions {
  reason?: string;
}

const ACTIVE_STAGE_STATUSES = new Set<StageStatus>([
  "ready",
  "in_progress",
  "awaiting_approval",
  "verifying",
  "blocked",
]);

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
  private readonly projectId: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(options: WorkflowRunServiceOptions) {
    if (!options.projectId.trim()) {
      throw new Error("WorkflowRunService requires a non-empty projectId.");
    }
    this.store = new FileStateStore(options.projectRoot);
    this.projectId = options.projectId;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
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

  async transitionStage(
    runId: string,
    workflow: WorkflowDefinition,
    stageId: string,
    to: StageStatus,
    options: StageTransitionOptions = {},
  ): Promise<WorkflowRunSnapshot> {
    let snapshot = await this.loadConsistentRun(runId, workflow);
    if (["created", "completed", "cancelled"].includes(snapshot.status)) {
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

    const timestamp = this.timestamp();
    const nextStage = transitionStageState(currentStage, {
      to,
      event_sequence: snapshot.last_event_sequence + 1,
      timestamp,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
    });

    const payload: Record<string, unknown> = { stage_id: stageId, to };
    if (options.reason !== undefined) payload.reason = options.reason;

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
    const executionScope = this.requiredExecutionStageIds(workflow);

    for (const definition of workflow.stages) {
      if (!executionScope.has(definition.id)) continue;
      const stage = snapshot.stages[definition.id];
      if (!stage || stage.status !== "pending") continue;
      if (!this.dependenciesCompleted(definition, snapshot)) continue;

      const timestamp = this.timestamp();
      const next = transitionStageState(stage, {
        to: "ready",
        event_sequence: snapshot.last_event_sequence + 1,
        timestamp,
      });
      snapshot = await this.commitStageState(
        snapshot,
        next,
        "stage.transitioned",
        { stage_id: definition.id, to: "ready" },
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
    const definitions = new Map(
      workflow.stages.map((stage) => [stage.id, stage] as const),
    );
    const required = new Set<string>();

    const visit = (stageId: string): void => {
      if (required.has(stageId)) return;
      required.add(stageId);
      const definition = definitions.get(stageId);
      for (const dependency of definition?.depends_on ?? []) {
        visit(dependency);
      }
    };

    for (const stageId of workflow.completion.required_stages) {
      visit(stageId);
    }

    return required;
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

    const sequence = current.last_event_sequence + 1;
    const next: WorkflowRunSnapshot = {
      ...current,
      status,
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
    const executionScope = this.requiredExecutionStageIds(workflow);
    const executionStages = [...executionScope]
      .map((stageId) => snapshot.stages[stageId])
      .filter((stage): stage is StageRunState => stage !== undefined);

    let status: RunStatus = "running";
    if (requiredStatuses.every((stageStatus) => stageStatus === "completed")) {
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
