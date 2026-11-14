# Workflow Validation and Planning

Aether validates workflow definitions in two distinct passes.

## 1. Structural validation

The `@aether/schemas` package validates YAML-decoded data against the canonical JSON Schema Draft 2020-12 workflow contract. Structural validation checks required fields, property types, enums, and the shape of declarative conditions.

## 2. Semantic validation

The Core package validates cross-references and graph semantics that JSON Schema alone cannot reliably enforce:

- Duplicate stage identifiers.
- Missing dependency references.
- Self-dependencies.
- Circular dependencies.
- Unknown entry stages.
- Unknown required completion stages.

## Execution waves

`buildExecutionWaves` returns stable topological waves. Stages in the same wave have no dependencies on each other and are candidates for parallel execution, subject to platform capabilities, file-scope conflicts, and policy.

The function plans work; it does not execute agents.

## CLI

```bash
aether workflow validate workflows/feature.yaml
```

The CLI reports structural or semantic errors and prints the proposed execution waves for a valid workflow.
