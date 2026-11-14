# Aether Schemas

Canonical public contracts live in `json-schema/` and use JSON Schema Draft 2020-12.

The schemas cover workflow definitions, run state, task contracts, delegation handoffs, task result submissions, adapter descriptors, events, approvals, and project configuration.

JSON Schema validates data shape. Core semantic validators additionally check cross-references, dependency cycles, state transitions, event sequences, run/workflow version identity, path containment, task file scope, evidence output location, approval binding, and verification manifest integrity.

Never use `eval` to evaluate workflow conditions. Conditions must be interpreted by a restricted deterministic evaluator.

Schema version 1 is the initial persistence contract. Breaking persisted-format changes require migration code and fixtures.
