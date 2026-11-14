export class RunLockedError extends Error {
  constructor(readonly runId: string) {
    super('Run "' + runId + '" is locked by another Aether process.');
    this.name = "RunLockedError";
  }
}

export class RunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super('Run "' + runId + '" does not exist.');
    this.name = "RunNotFoundError";
  }
}

export class RunAlreadyExistsError extends Error {
  constructor(readonly runId: string) {
    super('Run "' + runId + '" already exists.');
    this.name = "RunAlreadyExistsError";
  }
}

export class StateIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StateIntegrityError";
  }
}

export class EventSequenceError extends Error {
  constructor(
    readonly runId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super('Invalid event sequence for run "' + runId + '": expected ' + expected + ', received ' + actual + '.');
    this.name = "EventSequenceError";
  }
}

export class InvalidStageTransitionError extends Error {
  constructor(
    readonly stageId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super('Stage "' + stageId + '" cannot transition from "' + from + '" to "' + to + '".');
    this.name = "InvalidStageTransitionError";
  }
}

export class InvalidStageEventSequenceError extends Error {
  constructor(
    readonly stageId: string,
    readonly previousSequence: number,
    readonly actualSequence: number,
  ) {
    super('Stage "' + stageId + '" event sequence must be greater than ' + previousSequence + '; received ' + actualSequence + '.');
    this.name = "InvalidStageEventSequenceError";
  }
}
