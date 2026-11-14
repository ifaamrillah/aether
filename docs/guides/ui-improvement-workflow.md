# UI Improvement Workflow

Aether includes a UI-focused workflow for changes where interface structure and interaction design must be reviewed before production implementation.

## Run it

Validate and start the workflow definition at workflows/ui-improvement.yaml. Provide the ui_change input with the desired interface outcome.

## Required design sequence

The workflow intentionally orders these stages before the engineering specification:

1. Discovery: user task, current behavior, desired outcome, and constraints.
2. UI/UX research: journeys, product conventions, responsive needs, and accessibility.
3. Design system: reuse or define semantic tokens and component variants.
4. Wireframing: low-fidelity layouts and interaction states.
5. Prototyping: a reviewable visual/interactive artifact and recorded feedback.
6. Specification: translate the accepted design into testable requirements.

Implementation begins only after specification and planning. Visual testing and accessibility audit then run as independent verification stages before code review.

## Agent coordination

Use the agent-orchestration skill to delegate independent research or verification to native subagents when the active host exposes that capability. Do not infer subagent availability from platform markers alone. If the host cannot delegate, perform stages sequentially.

## Design artifact expectations

The prototype should be reviewable but should not be treated as production-ready code by default. Keep prototypes isolated or remove temporary code. Record relevant browser and viewport details for screenshots. Use synthetic data for sensitive or external systems.

The workflow creates task handoffs under the Aether handoffs directory. A task result must include evidence under the task's output directory and pass the Aether accept command before its stage can complete.
