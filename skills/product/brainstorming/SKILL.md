---
name: brainstorming
description: Explore and compare solution approaches before committing to requirements or implementation. Use when a problem has multiple plausible approaches or trade-offs need to be made explicit.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: product
---

# Product Brainstorming

## Objective
Generate a small, decision-useful set of approaches. Brainstorming is exploration, not approval to implement.

## Procedure
1. Restate the problem, desired outcome, constraints, and known decisions.
2. Identify dimensions that can vary: user flow, architecture, data, interaction, operations, and rollout.
3. Generate two to four materially different approaches, including the simplest viable option.
4. Describe benefits, costs, dependencies, risks, and user experience for each.
5. Compare options against stated goals and constraints.
6. Identify assumptions that could change the recommendation.
7. Recommend one direction with reasons and record unresolved choices for human decision.
8. Convert the selected direction into requirements only after it is explicitly accepted.

## Deliverable
A brief with problem, constraints, alternatives, trade-offs, recommendation, assumptions, risks, and decisions requiring human input.

## Guardrails
- Do not present speculative benefits as measured outcomes.
- Do not overwhelm the user with nearly identical options.
- Do not silently treat a recommendation as approved.
- Do not start implementation during exploration unless requested.
