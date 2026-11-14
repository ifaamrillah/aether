---
name: refactoring
description: Improve internal code structure while preserving externally observable behavior. Use for duplication, complexity, maintainability, module-boundary, or technical-debt work.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: engineering
---

# Refactoring

## Objective
Make a behavior-preserving change with a clear reason, bounded scope, and regression evidence.

## Procedure
1. Identify the structural problem and observable behavior that must remain unchanged.
2. Read relevant tests and add characterization tests where behavior is under-specified.
3. Map callers, public interfaces, persistence formats, and compatibility constraints.
4. Choose the smallest refactoring sequence that keeps the repository buildable and tests meaningful.
5. Make incremental changes without mixing unrelated feature work or broad formatting churn.
6. Run targeted tests after each meaningful step, then full repository checks.
7. Compare before/after behavior and complexity indicators; document any intentional behavior change separately.

## Deliverable
Refactoring report with rationale, invariants, changed paths, tests run, compatibility notes, and known residual debt.

## Guardrails
- Do not disguise feature changes as refactoring.
- Do not delete tests merely because they fail after a refactor.
- Do not change public contracts or persisted formats without migration and compatibility review.
- Do not claim performance improvement without measurement.
