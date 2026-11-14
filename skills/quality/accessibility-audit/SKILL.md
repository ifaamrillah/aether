---
name: accessibility-audit
description: Evaluate UI semantics, keyboard interaction, focus management, labels, contrast, and assistive-technology support. Use for new interfaces, redesigns, forms, navigation, dialogs, and accessibility remediation.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: quality
---

# Accessibility Audit

## Objective
Identify barriers that prevent people from perceiving, understanding, navigating, or operating the interface, and provide reproducible remediation guidance.

## Procedure
1. Identify relevant journeys, components, and the accessibility target agreed for the project.
2. Inspect semantic HTML, landmarks, heading hierarchy, accessible names, roles, and relationships.
3. Test keyboard-only operation, logical focus order, visible focus, escape behavior, and focus restoration.
4. Check labels, instructions, error association, validation announcements, and input types.
5. Check contrast, non-color cues, zoom/reflow, text sizing, and reduced-motion behavior.
6. Exercise dialogs, menus, tabs, autocomplete, and dynamic updates with keyboard interaction.
7. Use automated checks as a supplement, not a replacement for manual review.
8. Where supported, test with a screen reader and record the OS/browser/reader combination.
9. Classify findings by impact, affected users, reproduction steps, and remediation.
10. Re-test fixes and attach evidence.

## Deliverable
An accessibility report with scope/target, methods, findings, affected journeys, reproduction steps, fixes, retest evidence, and residual limitations.

## Guardrails
- Automated scanner success does not prove accessibility.
- Do not infer screen-reader behavior from DOM inspection alone.
- Do not declare conformance when significant product journeys were not tested.
- Do not use color as the only indicator of status or meaning.
