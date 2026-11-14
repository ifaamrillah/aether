---
name: prototyping
description: Build a reviewable UI prototype from approved wireframes before finalizing a UI specification or production implementation. Use when a visual or interaction change benefits from an executable or clickable proof.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: design
---

# UI Prototyping

## Objective
Make the proposed interface concrete enough to review interaction, hierarchy, responsiveness, and visual direction before production implementation.

## Procedure
1. Confirm wireframes and design-system inputs are available.
2. Choose the lightest suitable prototype medium: component sandbox, story, development-only route, or isolated prototype file.
3. Reuse the project's UI framework and components when that improves fidelity.
4. Implement the critical path and representative component states.
5. Include narrow and wide viewports when responsive behavior is relevant.
6. Demonstrate loading, empty, error, success, and disabled states where they affect the journey.
7. Capture screenshots or an interactive review artifact with browser, viewport, and source revision.
8. Review with the requester or designated reviewer and record feedback.
9. Update wireframes or design decisions before the specification is finalized.
10. Remove temporary code or isolate it so it cannot accidentally ship.

## Deliverable
Prototype entry point/artifact, screenshots or review evidence, implemented interactions, production-design differences, feedback, and specification handoff recommendation.

## Guardrails
- A prototype is not production-ready code by default.
- Do not connect real payment, messaging, or destructive endpoints.
- Use mock or synthetic data for sensitive or external systems.
- Do not claim an interaction works unless it was exercised.
