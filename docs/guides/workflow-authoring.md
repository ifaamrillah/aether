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
