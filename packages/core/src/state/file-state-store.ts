import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import type {
  LoadedRun,
  WorkflowEvent,
  WorkflowRunSnapshot,
} from "./types.js";
import {
  EventSequenceError,
  RunAlreadyExistsError,
  RunLockedError,
  RunNotFoundError,
  StateIntegrityError,
} from "./errors.js";

const require = createRequire(import.meta.url);
const { randomUUID } = require("node:crypto") as {
  randomUUID: () => string;
};

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function validateRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId)) {
    throw new StateIntegrityError(
      `Invalid run id "${runId}". Use 1-128 letters, digits, underscores, or hyphens.`,
    );
  }
}

async function atomicWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx", 0o600);

  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

/**
 * Local-first, file-backed run state.
 *
 * Each run has one exclusive writer lock. Snapshots are replaced atomically;
 * the append-only event log is fsynced after each appended event.
 */
export class FileStateStore {
  private readonly projectRoot: string;
  private readonly runsDirectory: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    this.runsDirectory = resolve(this.projectRoot, ".aether", "runs");

    if (
      this.runsDirectory !== this.projectRoot &&
      !this.runsDirectory.startsWith(this.projectRoot + sep)
    ) {
      throw new StateIntegrityError("The runs directory must remain inside the project root.");
    }
  }

  async initializeRun(
    snapshot: WorkflowRunSnapshot,
    initialEvent: WorkflowEvent,
  ): Promise<void> {
    validateRunId(snapshot.id);

    if (snapshot.schema_version !== 1 || initialEvent.schema_version !== 1) {
      throw new StateIntegrityError("Unsupported run or event schema version.");
    }
    if (initialEvent.run_id !== snapshot.id || initialEvent.sequence !== 1) {
      throw new StateIntegrityError("A new run must start with its own sequence-1 event.");
    }
    if (
      snapshot.last_event_sequence !== 1 ||
      snapshot.snapshot_sequence !== 1
    ) {
      throw new StateIntegrityError(
        "An initial run snapshot must reference the initial sequence-1 event.",
      );
    }

    await this.withRunLock(snapshot.id, async () => {
      const runDirectory = this.runDirectory(snapshot.id);

      try {
        await readFile(join(runDirectory, "run.json"), "utf8");
        throw new RunAlreadyExistsError(snapshot.id);
      } catch (error) {
        if (error instanceof RunAlreadyExistsError) throw error;
        if (errorCode(error) !== "ENOENT") throw error;
      }

      const temporaryDirectory = join(
        this.runsDirectory,
        `.${snapshot.id}.tmp-${randomUUID()}`,
      );

      await mkdir(temporaryDirectory, { recursive: false });
      try {
        await atomicWriteFile(
          join(temporaryDirectory, "run.json"),
          JSON.stringify(snapshot, null, 2) + "\n",
        );

        const eventHandle = await open(join(temporaryDirectory, "events.jsonl"), "wx", 0o600);
        try {
          await eventHandle.writeFile(JSON.stringify(initialEvent) + "\n", "utf8");
          await eventHandle.sync();
        } finally {
          await eventHandle.close();
        }

        await rename(temporaryDirectory, runDirectory);
      } catch (error) {
        await rm(temporaryDirectory, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async loadRun(runId: string): Promise<LoadedRun> {
    validateRunId(runId);

    return this.withRunLock(runId, async () => {
      const runDirectory = this.runDirectory(runId);
      let snapshot: WorkflowRunSnapshot;

      try {
        snapshot = JSON.parse(
          await readFile(join(runDirectory, "run.json"), "utf8"),
        ) as WorkflowRunSnapshot;
      } catch (error) {
        if (errorCode(error) === "ENOENT") throw new RunNotFoundError(runId);
        if (error instanceof SyntaxError) {
          throw new StateIntegrityError(`Run "${runId}" has invalid JSON in run.json.`, { cause: error });
        }
        throw error;
      }

      if (snapshot.schema_version !== 1 || snapshot.id !== runId) {
        throw new StateIntegrityError(`Run "${runId}" has an unsupported or mismatched snapshot.`);
      }

      const events = await this.readEventsUnlocked(runId);
      if (events.length === 0) {
        throw new StateIntegrityError(`Run "${runId}" has no event history.`);
      }
      if (snapshot.snapshot_sequence > events.length) {
        throw new StateIntegrityError(
          `Run "${runId}" snapshot sequence exceeds the event log length.`,
        );
      }
      if (snapshot.last_event_sequence !== snapshot.snapshot_sequence) {
        throw new StateIntegrityError(
          `Run "${runId}" snapshot sequence fields are inconsistent.`,
        );
      }

      return {
        snapshot,
        pendingEvents: events.filter((event) => event.sequence > snapshot.snapshot_sequence),
      };
    });
  }

  async readEvents(runId: string, afterSequence = 0): Promise<WorkflowEvent[]> {
    validateRunId(runId);

    return this.withRunLock(runId, async () => {
      const events = await this.readEventsUnlocked(runId);
      return events.filter((event) => event.sequence > afterSequence);
    });
  }

  async appendEvent(runId: string, event: WorkflowEvent): Promise<void> {
    validateRunId(runId);
    if (event.schema_version !== 1 || event.run_id !== runId) {
      throw new StateIntegrityError("Event schema version or run id does not match.");
    }

    await this.withRunLock(runId, async () => {
      const runDirectory = this.runDirectory(runId);
      const events = await this.readEventsUnlocked(runId);
      const expected = (events.at(-1)?.sequence ?? 0) + 1;

      if (event.sequence !== expected) {
        throw new EventSequenceError(runId, expected, event.sequence);
      }

      const handle = await open(join(runDirectory, "events.jsonl"), "a", 0o600);
      try {
        await handle.writeFile(JSON.stringify(event) + "\n", "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
  }

  async writeSnapshot(snapshot: WorkflowRunSnapshot): Promise<void> {
    validateRunId(snapshot.id);
    if (snapshot.schema_version !== 1) {
      throw new StateIntegrityError("Unsupported run schema version.");
    }

    await this.withRunLock(snapshot.id, async () => {
      const runDirectory = this.runDirectory(snapshot.id);
      const events = await this.readEventsUnlocked(snapshot.id);
      const lastSequence = events.at(-1)?.sequence ?? 0;

      if (
        snapshot.last_event_sequence !== lastSequence ||
        snapshot.snapshot_sequence !== lastSequence
      ) {
        throw new StateIntegrityError(
          `Snapshot for run "${snapshot.id}" must incorporate the latest event sequence (${lastSequence}).`,
        );
      }

      await atomicWriteFile(
        join(runDirectory, "run.json"),
        JSON.stringify(snapshot, null, 2) + "\n",
      );
    });
  }

  private runDirectory(runId: string): string {
    const path = resolve(this.runsDirectory, runId);
    if (!path.startsWith(this.runsDirectory + sep)) {
      throw new StateIntegrityError("Resolved run path escaped the runs directory.");
    }
    return path;
  }

  private async readEventsUnlocked(runId: string): Promise<WorkflowEvent[]> {
    let contents: string;
    try {
      contents = await readFile(join(this.runDirectory(runId), "events.jsonl"), "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") throw new RunNotFoundError(runId);
      throw error;
    }

    const events: WorkflowEvent[] = [];
    const seenIds = new Set<string>();
    const lines = contents.split("\n");

    for (const [index, line] of lines.entries()) {
      if (line.length === 0) continue;

      let event: WorkflowEvent;
      try {
        event = JSON.parse(line) as WorkflowEvent;
      } catch (error) {
        throw new StateIntegrityError(
          `Run "${runId}" has invalid event JSON on line ${index + 1}.`,
          { cause: error },
        );
      }

      const expectedSequence = events.length + 1;
      if (
        event.schema_version !== 1 ||
        event.run_id !== runId ||
        event.sequence !== expectedSequence ||
        seenIds.has(event.event_id)
      ) {
        throw new StateIntegrityError(
          `Run "${runId}" event log is inconsistent on line ${index + 1}.`,
        );
      }

      seenIds.add(event.event_id);
      events.push(event);
    }

    return events;
  }

  private async withRunLock<T>(
    runId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    await mkdir(this.runsDirectory, { recursive: true });
    const lockPath = join(this.runsDirectory, `${runId}.lock`);
    let lockHandle;

    try {
      lockHandle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (errorCode(error) === "EEXIST") throw new RunLockedError(runId);
      throw error;
    }

    try {
      await lockHandle.writeFile(
        JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }),
        "utf8",
      );
      await lockHandle.sync();
      return await operation();
    } finally {
      await lockHandle.close();
      await rm(lockPath, { force: true });
    }
  }
}
