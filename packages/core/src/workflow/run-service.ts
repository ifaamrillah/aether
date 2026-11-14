import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { FileStateStore } from "../state/file-state-store.js";
import type {
  RunStatus,
  StageRunState,
  StageStatus,
  WorkflowEvent,
  WorkflowRunSnapshot,
  StageVerificationReference,
} from "../state/types.js";
import { transitionStageState } from "../state/stage-transitions.js";
import { StateIntegrityError } from "../state/errors.js";
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
  verification?: StageVerificationReference;
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

  constructor(options: WorkflowRunServiceOptions) {
    if (!options.projectId.trim()) {
      throw new Error("WorkflowRunService requires a non-empty projectId.");
    }
    this.projectRoot = resolve(options.projectRoot);
    this.store = new FileStateStore(this.projectRoot);
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

        const nextStage = transitionStageState(currentStage, {
          to: targetStatus,
          event_sequence: event.sequence,
          timestamp: event.timestamp,
          ...(typeof event.payload.reason === "string"
            ? { reason: event.payload.reason }
            : {}),
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
    // stages were promoted. Reconcile eligible stages after replay.
    if (snapshot.status === "running") {
      snapshot = await this.promoteReadyStages(snapshot, workflow);
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
    });

    const payload: Record<string, unknown> = { stage_id: stageId, to };
    if (options.reason !== undefined) payload.reason = options.reason;
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

      const absolute = resolve(root, ...path.split("/"));
      const actual = await realpath(absolute).catch(() => invalid(label + " does not exist."));
      const rel = relative(root, actual);
      if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
        invalid(label + " resolves outside the project root.");
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

    const writePaths = definition.scope?.write_paths ?? [];
    for (const changedPath of manifest.changed_files) {
      if (
        typeof changedPath !== "string" ||
        !isWithinScope(changedPath, writePaths)
      ) {
        invalid("changed file is outside the declared write scope.");
      }
      const changedAbsolute = await safeProjectPath(changedPath, "changed file");
      if (!(await stat(changedAbsolute)).isFile()) {
        invalid("changed file is not a regular file.");
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
    for (const item of manifest.evidence) {
      if (
        typeof item !== "object" ||
        item === null ||
        !("path" in item) ||
        typeof item.path !== "string" ||
        !("sha256" in item) ||
        typeof item.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.sha256) ||
        !("size_bytes" in item) ||
        typeof item.size_bytes !== "number" ||
        !("result" in item) ||
        (item.result !== "passed" && item.result !== "informational") ||
        !("type" in item) ||
        typeof item.type !== "string" ||
        !allowedEvidenceTypes.includes(item.type) ||
        !isWithinScope(item.path, outputScope)
      ) {
        invalid("evidence record is malformed.");
      }

      if (item.result === "passed") hasPassingEvidence = true;
      const evidenceAbsolute = await safeProjectPath(item.path, "evidence file");
      const evidenceStats = await stat(evidenceAbsolute);
      if (!evidenceStats.isFile() || evidenceStats.size !== item.size_bytes || evidenceStats.size === 0) {
        invalid("evidence file size or type has changed.");
      }
      const evidenceDigest = createHash("sha256")
        .update(await readFile(evidenceAbsolute))
        .digest("hex");
      if (evidenceDigest !== item.sha256) {
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
