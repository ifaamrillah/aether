---
name: design-system
description: Define or extend interface tokens, component patterns, and visual rules consistently with an existing product. Use before wireframing or implementation when a UI change needs a coherent visual language.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: design
---

# Design System

## Objective
Create a practical, implementation-aware design system for the requested surface without unnecessary abstractions or overriding the product's established language.

## Procedure
1. Inspect existing tokens, CSS variables, themes, component library, and visual conventions.
2. Reuse existing foundations when adequate; explain required changes.
3. Define semantic color, typography, spacing, sizing, radius, elevation, border, and motion tokens.
4. Define component behavior and variants for the controls relevant to the task.
5. Specify responsive behavior, focus, hover, pressed, disabled, and contrast expectations.
6. Map token ownership to repository paths.
7. Provide examples showing how proposed tokens and components compose.
8. Check that the proposal supports actual screens without duplicating primitives.

## Deliverable
An inventory of existing foundations, proposed tokens, component variants, interaction states, responsive rules, implementation mapping, and rationale.

## Guardrails
- Do not replace a design system merely to express personal taste.
- Do not hardcode isolated values when semantic tokens exist.
- Do not add abstractions without a plausible reuse case.
- Do not claim contrast compliance without checking actual color pairs.
