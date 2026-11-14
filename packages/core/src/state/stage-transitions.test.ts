import { describe, expect, it } from "vitest";
import {
  getAllowedStageTransitions,
  transitionStageState,
} from "./stage-transitions.js";
import type { StageRunState, StageStatus } from "./types.js";
import {
  InvalidStageEventSequenceError,
  InvalidStageTransitionError,
  StateIntegrityError,
} from "./errors.js";

const timestamp = "2026-11-15T01:30:00.000Z";

function createStage(status: StageStatus = "pending"): StageRunState {
  return {
    stage_id: "implementation",
    status,
    attempt: 0,
    inputs: [],
    outputs: [],
    last_event_sequence: 1,
  };
}

describe("stage lifecycle state machine", () => {
  it("exposes the legal transitions for every stage status", () => {
    const statuses: StageStatus[] = [
      "pending",
      "ready",
      "in_progress",
      "blocked",
      "awaiting_approval",
      "verifying",
      "completed",
      "failed",
      "skipped",
      "stale",
    ];

    for (const status of statuses) {
      expect(Array.isArray(getAllowedStageTransitions(status))).toBe(true);
    }

    expect(getAllowedStageTransitions("completed")).toEqual(["stale"]);
    expect(getAllowedStageTransitions("pending")).toEqual(["ready", "skipped"]);
  });

  it("advances a stage and increments the attempt when execution starts", () => {
    const pending = createStage();
    const ready = transitionStageState(pending, {
      to: "ready",
      event_sequence: 2,
      timestamp,
    });
    const running = transitionStageState(ready, {
      to: "in_progress",
      event_sequence: 5,
      timestamp,
    });

    expect(ready.status).toBe("ready");
    expect(running.status).toBe("in_progress");
    expect(running.attempt).toBe(1);
    expect(running.started_at).toBe(timestamp);
    expect(running.last_event_sequence).toBe(5);
    expect(pending.status).toBe("pending");
    expect(pending.attempt).toBe(0);
  });

  it("records completion time after verification", () => {
    const verifying = createStage("verifying");
    const completed = transitionStageState(verifying, {
      to: "completed",
      event_sequence: 8,
      timestamp,
    });

    expect(completed.status).toBe("completed");
    expect(completed.completed_at).toBe(timestamp);
  });

  it("requires an explanation when a stage is blocked", () => {
    expect(() =>
      transitionStageState(createStage("ready"), {
        to: "blocked",
        event_sequence: 2,
        timestamp,
      }),
    ).toThrow(StateIntegrityError);

    const blocked = transitionStageState(createStage("ready"), {
      to: "blocked",
      event_sequence: 2,
      timestamp,
      reason: "Waiting for an approved API contract.",
    });

    expect(blocked.blocked_reason).toBe(
      "Waiting for an approved API contract.",
    );
  });

  it("rejects transitions that are not in the lifecycle contract", () => {
    expect(() =>
      transitionStageState(createStage("pending"), {
        to: "completed",
        event_sequence: 2,
        timestamp,
      }),
    ).toThrow(InvalidStageTransitionError);
  });

  it("requires strictly increasing run event sequence numbers", () => {
    expect(() =>
      transitionStageState(createStage("pending"), {
        to: "ready",
        event_sequence: 1,
        timestamp,
      }),
    ).toThrow(InvalidStageEventSequenceError);
  });

  it("rejects invalid timestamps", () => {
    expect(() =>
      transitionStageState(createStage("pending"), {
        to: "ready",
        event_sequence: 2,
        timestamp: "not-a-date",
      }),
    ).toThrow(StateIntegrityError);
  });

  it("clears a block reason when the stage becomes ready again", () => {
    const blocked = transitionStageState(createStage("ready"), {
      to: "blocked",
      event_sequence: 2,
      timestamp,
      reason: "Approval is pending.",
    });
    const ready = transitionStageState(blocked, {
      to: "ready",
      event_sequence: 4,
      timestamp,
    });

    expect(ready.status).toBe("ready");
    expect(ready.blocked_reason).toBeUndefined();
  });

  it("starts a new attempt when a failed stage is retried", () => {
    const failed = createStage("failed");
    failed.attempt = 1;
    failed.started_at = "2026-11-14T20:00:00.000Z";

    const ready = transitionStageState(failed, {
      to: "ready",
      event_sequence: 2,
      timestamp,
    });
    const retried = transitionStageState(ready, {
      to: "in_progress",
      event_sequence: 3,
      timestamp,
    });

    expect(retried.attempt).toBe(2);
    expect(retried.started_at).toBe(timestamp);
    expect(retried.completed_at).toBeUndefined();
  });
});
