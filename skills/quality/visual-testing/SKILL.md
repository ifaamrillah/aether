---
name: visual-testing
description: Verify rendered interfaces using browser automation, screenshots, and visual regression evidence. Use after UI implementation or when layout, styling, responsive behavior, or interaction states change.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: quality
---

# Visual Testing

## Objective
Detect unintended visual and interaction regressions across relevant screen states and viewports.

## Procedure
1. Identify changed screens, critical journeys, supported viewports, and expected states.
2. Inspect browser automation configuration, screenshot baselines, and test conventions.
3. Start the application using its documented command.
4. Exercise the critical journey with stable selectors and realistic fixtures.
5. Capture screenshots at agreed viewports and relevant loading, empty, error, and success states.
6. Compare with approved references or baselines; explain intentional visual changes.
7. Inspect console errors, failed requests, and interaction failures.
8. Attach screenshots, traces, test output, and environment details.
9. Report flaky tests separately from genuine regressions.

## Deliverable
A visual test report with routes/scenarios, browser and viewport, commands and exit status, evidence paths, regressions, and untested states.

## Guardrails
- Do not update a screenshot baseline just to make a failing comparison pass.
- Do not claim browser automation passed when only static screenshots were inspected.
- Do not hide console errors without documenting why they are harmless.
