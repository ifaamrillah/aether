# Authoring Aether Workflows

Workflows are declarative YAML definitions validated by the canonical JSON Schema and Core semantic validator.

## Minimal workflow

```yaml
schema_version: 1
id: documentation-update
version: 1
name: Documentation Update
description: Update docs against verified implementation behavior.

inputs:
  - name: documentation_goal
    type: string
    required: true

stages:
  - id: discovery
    skill: discovery
    required: true
    scope:
      read_paths:
        - src/**
        - docs/**
      write_paths:
        - docs/aether/discovery/**
    acceptance_criteria:
      - Identify relevant implementation sources.
      - Record findings with source paths.

  - id: documentation
    skill: documentation
    required: true
    depends_on:
      - discovery
    scope:
      read_paths:
        - src/**
        - docs/aether/discovery/**
      write_paths:
        - docs/**
    acceptance_criteria:
      - Update only statements supported by evidence.

completion:
  required_stages:
    - discovery
    - documentation
```

## Supported concepts

- `inputs`: string, number, boolean, array, or object values, with required/default fields.
- `stages`: unique stage IDs, a portable skill reference, required/optional flag, dependencies, optional condition, scope, and acceptance criteria.
- `depends_on`: stage IDs that must be completed before the stage becomes ready.
- `condition`: a restricted declarative expression; arbitrary JavaScript or eval is not supported.
- `scope.read_paths` / `scope.write_paths`: project-relative paths communicated to task handoff. They are not an OS sandbox.
- `completion.required_stages`: stages that define the workflow's required completion path.

The run service schedules the transitive dependency closure of the required completion stages. An optional stage that is a prerequisite for a required stage is still part of that path. Independent optional stages remain dormant unless a future workflow feature explicitly selects them.

## Conditional stages

A stage may declare a restricted condition expression. Conditions are evaluated only after all declared dependencies have completed.

Supported operators are:
- eq and neq for equality and inequality.
- in when the right operand resolves to an array.
- and, or, and not for boolean composition.
- exists to test whether a reference is present.

References may read workflow inputs (input.name), project context (project.name), capability context (capability.name), and dependency stage fields (stage.stage-id.status). Nested object fields are supported. A comparison against an unavailable reference fails closed with an evaluation error; exists returns false for a missing reference. Arbitrary JavaScript and eval are never executed.

Conditional stages must be optional and must not be part of the required completion dependency closure. Their dependencies must all belong to the required execution path. A true condition makes the stage ready; a false condition records the stage as skipped. If a condition is true, that selected stage must itself complete before the run can complete. Optional stages without conditions remain dormant unless they are dependencies of required completion stages.

Conditions are evaluated against the run's persisted inputs and the project/capability context supplied to WorkflowRunService. The CLI supplies the project ID automatically. Embedded integrations may supply additional project and capability fields. Context used by a condition should remain stable for the lifetime of a run; create a new workflow run when those assumptions change.

## Validation

```bash
node apps/cli/dist/index.js workflow validate workflows/my-workflow.yaml
node apps/cli/dist/index.js workflow list workflows
```

The validator checks JSON Schema shape and semantic references/cycles. It does not prove that a skill exists in every external platform or that an agent can perform the work.

## Authoring rules

- Keep workflows intent-specific; do not force all tasks through a single lifecycle.
- Use small stages with explicit outputs and acceptance criteria.
- Parallelize only independent work; workflow definitions express dependencies, while host-native execution remains responsible for actual agent concurrency.
- Never store secrets in workflow inputs; run snapshots persist input values locally.
- Treat skipped optional stages as skipped, not completed. They do not satisfy dependencies.
- Require independent verification before task or stage completion.
- Keep the workflow version stable for an existing run. A run pins its workflow ID and version.
- Add positive, negative, and dependency-cycle fixtures when changing workflow behavior.

Installed workflows are placed under `workflows/aether/` and tracked in the managed-file manifest. User-owned files and locally modified managed files are preserved during update and uninstall.
