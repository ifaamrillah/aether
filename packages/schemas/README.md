# Aether Schemas

Canonical public contracts live in `json-schema/` and use JSON Schema Draft 2020-12.

JSON Schema validates data shape. Core semantic validators must additionally check workflow stage references and dependency cycles, state transition legality, run/event sequence consistency, task dependency integrity and file-scope conflicts, artifact ID/path consistency, approval binding to an exact action digest, and filesystem path containment after normalization.

Never use `eval` to evaluate workflow conditions. Conditions must be interpreted by a restricted deterministic evaluator.

Schema version 1 is the initial persistence contract. Breaking persisted-format changes require migration code and fixtures.
