export class WorkflowInputValidationError extends Error {
  constructor(readonly issues: string[]) {
    super("Invalid workflow inputs:\n- " + issues.join("\n- "));
    this.name = "WorkflowInputValidationError";
  }
}

export class WorkflowRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRunConflictError";
  }
}

export class RunRecoveryRequiredError extends Error {
  constructor(
    readonly runId: string,
    readonly pendingEventCount: number,
  ) {
    super(
      'Run "' + runId + '" has ' + pendingEventCount + " event(s) not reflected in its snapshot. Recovery is required before continuing.",
    );
    this.name = "RunRecoveryRequiredError";
  }
}
