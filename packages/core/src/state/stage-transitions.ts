import type { StageRunState, StageStatus } from "./types.js";
import {
  InvalidStageEventSequenceError,
  InvalidStageTransitionError,
  StateIntegrityError,
} from "./errors.js";

const ALLOWED_TRANSITIONS = {
  pending: ["ready", "skipped"],
  ready: ["in_progress", "blocked", "awaiting_approval", "skipped"],
  in_progress: ["verifying", "blocked", "failed"],
  blocked: ["ready", "failed"],
  awaiting_approval: ["ready", "blocked", "failed"],
  verifying: ["completed", "failed", "blocked"],
  completed: ["stale"],
  failed: ["ready", "blocked"],
  skipped: ["stale"],
  stale: ["ready", "skipped"],
} as const satisfies Record<StageStatus, readonly StageStatus[]>;

export interface StageTransitionInput {
  to: StageStatus;
  event_sequence: number;
  timestamp: string;
  reason?: string;
}

/** Returns the legal next states for a stage in its current state. */
export function getAllowedStageTransitions(
  status: StageStatus,
): readonly StageStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

/**
 * Applies a validated stage transition without mutating the input.
 *
 * The event sequence is the run-wide sequence of the event that records this
 * transition. It must be strictly greater than the stage's last known event
 * sequence; it need not be contiguous because other run entities may emit
 * events between transitions of this stage.
 */
export function transitionStageState(
  current: StageRunState,
  input: StageTransitionInput,
): StageRunState {
  const allowed = ALLOWED_TRANSITIONS[current.status];
  if (!allowed.includes(input.to as never)) {
    throw new InvalidStageTransitionError(
      current.stage_id,
      current.status,
      input.to,
    );
  }

  if (
    !Number.isSafeInteger(input.event_sequence) ||
    input.event_sequence <= current.last_event_sequence
  ) {
    throw new InvalidStageEventSequenceError(
      current.stage_id,
      current.last_event_sequence,
      input.event_sequence,
    );
  }

  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      input.timestamp,
    ) ||
    !Number.isFinite(Date.parse(input.timestamp))
  ) {
    throw new StateIntegrityError(
      `Invalid RFC 3339 timestamp for stage "${current.stage_id}".`,
    );
  }

  if (input.to === "blocked" && !input.reason?.trim()) {
    throw new StateIntegrityError(
      `A reason is required when stage "${current.stage_id}" becomes blocked.`,
    );
  }

  const next: StageRunState = {
    ...current,
    status: input.to,
    last_event_sequence: input.event_sequence,
  };

  if (input.to === "in_progress") {
    next.attempt += 1;
    next.started_at = input.timestamp;
    delete next.completed_at;
    delete next.blocked_reason;
  } else if (input.to === "completed") {
    next.completed_at = input.timestamp;
    delete next.blocked_reason;
  } else if (input.to === "blocked") {
    next.blocked_reason = input.reason!.trim();
  } else if (input.to === "ready") {
    delete next.blocked_reason;
  }

  return next;
}
