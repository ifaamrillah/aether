---
name: architecture
description: Design or evolve system architecture using explicit quality attributes, boundaries, contracts, and trade-offs. Use for new systems, major changes, integrations, or architectural decisions.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: engineering
---

# Architecture

## Objective
Produce an architecture that fits the approved requirements, existing repository constraints, operational context, and long-term evolution needs.

## Procedure
1. Review approved requirements, existing architecture, codebase boundaries, ADRs, security constraints, and operational goals.
2. Identify quality attributes and constraints: reliability, latency, scalability, maintainability, security, privacy, portability, and cost.
3. Describe components, responsibilities, dependencies, trust boundaries, data ownership, and critical runtime flows.
4. Compare viable options and record meaningful trade-offs; prefer the simplest design that satisfies the requirements.
5. Define interface contracts, state ownership, failure handling, observability, migration strategy, and testing implications.
6. Record decisions in ADRs and link them to requirements and affected code areas.
7. Review the design with implementation and operations stakeholders before treating it as approved.

## Deliverable
Architecture specification with context, component/dependency diagrams, contracts, quality attributes, alternatives, risks, migration plan, and ADR references.

## Guardrails
- Do not invent traffic, benchmark, or reliability targets.
- Do not introduce infrastructure or services without an operational owner and reason.
- Do not silently change an accepted ADR; report drift and propose a new decision.
- Do not treat a diagram as proof that the design is implemented.
