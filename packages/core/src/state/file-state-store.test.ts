import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EventSequenceError,
  FileStateStore,
  RunAlreadyExistsError,
  RunLockedError,
  StateIntegrityError,
} from "./index.js";
import type { WorkflowEvent, WorkflowRunSnapshot } from "./types.js";

let projectRoot: string;
let store: FileStateStore;

function createSnapshot(): WorkflowRunSnapshot {
  return {
    schema_version: 1,
    id: "run_test_001",
    workflow_id: "feature-development",
    workflow_version: 1,
    status: "created",
    project_id: "test-project",
    inputs: {},
    stages: {
      discovery: {
        stage_id: "discovery",
        status: "pending",
        attempt: 0,
        inputs: [],
        outputs: [],
        last_event_sequence: 1,
      },
    },
    current_stage_ids: ["discovery"],
    created_at: "2026-11-15T00:00:00.000Z",
    updated_at: "2026-11-15T00:00:00.000Z",
    last_event_sequence: 1,
    snapshot_sequence: 1,
  };
}

function createEvent(
  sequence: number,
  type = "run.created",
): WorkflowEvent {
  return {
    schema_version: 1,
    event_id: "event_" + sequence,
    run_id: "run_test_001",
    sequence,
    type,
    timestamp: "2026-11-15T00:00:00.000Z",
    actor: { type: "system", id: "aether" },
    entity: { type: "run", id: "run_test_001" },
    payload: {},
  };
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "aether-state-test-"));
  store = new FileStateStore(projectRoot);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("FileStateStore", () => {
  it("initializes a run atomically and loads its snapshot", async () => {
    await store.initializeRun(createSnapshot(), createEvent(1));

    const loaded = await store.loadRun("run_test_001");
    expect(loaded.snapshot.workflow_id).toBe("feature-development");
    expect(loaded.pendingEvents).toEqual([]);
  });

  it("prevents duplicate run initialization", async () => {
    await store.initializeRun(createSnapshot(), createEvent(1));

    await expect(
      store.initializeRun(createSnapshot(), createEvent(1)),
    ).rejects.toBeInstanceOf(RunAlreadyExistsError);
  });

  it("appends events in strict monotonic sequence", async () => {
    await store.initializeRun(createSnapshot(), createEvent(1));
    await store.appendEvent("run_test_001", createEvent(2, "run.paused"));

    const loaded = await store.loadRun("run_test_001");
    expect(loaded.pendingEvents.map((event) => event.sequence)).toEqual([2]);
    expect((await store.readEvents("run_test_001")).map((event) => event.sequence))
      .toEqual([1, 2]);
  });

  it("rejects event sequence gaps", async () => {
    await store.initializeRun(createSnapshot(), createEvent(1));

    await expect(
      store.appendEvent("run_test_001", createEvent(3, "run.paused")),
    ).rejects.toBeInstanceOf(EventSequenceError);
  });

  it("writes a snapshot only when it includes the latest event", async () => {
    await store.initializeRun(createSnapshot(), createEvent(1));
    await store.appendEvent("run_test_001", createEvent(2, "run.paused"));

    const snapshot = createSnapshot();
    snapshot.status = "paused";
    snapshot.last_event_sequence = 2;
    snapshot.snapshot_sequence = 2;

    await store.writeSnapshot(snapshot);

    const loaded = await store.loadRun("run_test_001");
    expect(loaded.snapshot.status).toBe("paused");
    expect(loaded.pendingEvents).toEqual([]);
  });

  it("rejects path traversal run identifiers", async () => {
    await expect(store.loadRun("../escape")).rejects.toBeInstanceOf(StateIntegrityError);
  });

  it("rejects operations while a run lock is held", async () => {
    const lockDirectory = join(projectRoot, ".aether", "runs");
    const { mkdir, open } = await import("node:fs/promises");
    await mkdir(lockDirectory, { recursive: true });
    const lock = await open(join(lockDirectory, "run_test_001.lock"), "wx");
    try {
      await expect(store.loadRun("run_test_001")).rejects.toBeInstanceOf(RunLockedError);
    } finally {
      await lock.close();
    }
  });

  it("persists newline-delimited event history", async () => {
    await store.initializeRun(createSnapshot(), createEvent(1));
    const logPath = join(projectRoot, ".aether", "runs", "run_test_001", "events.jsonl");
    const contents = await readFile(logPath, "utf8");
    expect(contents.endsWith("\n")).toBe(true);
    expect(contents.trim().split("\n")).toHaveLength(1);
  });

  it("commits an event and its matching snapshot under one run lock", async () => {
    await store.initializeRun(createSnapshot(), createEvent(1));
    const next = createSnapshot();
    next.status = "running";
    next.last_event_sequence = 2;
    next.snapshot_sequence = 2;

    await store.commitEventAndSnapshot(
      "run_test_001",
      createEvent(2, "run.started"),
      next,
    );

    const loaded = await store.loadRun("run_test_001");
    expect(loaded.snapshot.status).toBe("running");
    expect(loaded.pendingEvents).toEqual([]);
    expect((await store.readEvents("run_test_001")).map((event) => event.sequence))
      .toEqual([1, 2]);
  });

  it("rejects a snapshot that does not incorporate the new event", async () => {
    await store.initializeRun(createSnapshot(), createEvent(1));
    const next = createSnapshot();

    await expect(
      store.commitEventAndSnapshot(
        "run_test_001",
        createEvent(2, "run.started"),
        next,
      ),
    ).rejects.toBeInstanceOf(StateIntegrityError);
  });
});
