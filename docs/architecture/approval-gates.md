# Workflow Approval Gates

Aether can pause a stage at an explicit decision point. This is a workflow control, not a security sandbox or an external-action authorization service.

## Configuration

A stage can omit `approval` or set `mode: none` to run without a gate. A required gate is created once dependencies and conditions are satisfied:

```yaml
- id: protected-change
  skill: implementation
  required: true
  approval:
    mode: required
    risk: high
    require_signature: true
    allowed_approvers: [release-maintainer]
    required_roles: [maintainer, security]
    prevent_self_approval: true
```

Supported modes:

- `none`: no approval gate.
- `optional`: the stage becomes ready normally; an operator may request approval before handoff.
- `required`: the stage enters `awaiting_approval` when eligible and cannot become ready without an approved decision.

Risk values are `low`, `medium`, `high`, and `critical`; the default is `medium`. Use `require_signature: true` when the decision must be authenticated cryptographically. `allowed_approvers` limits identity IDs, `required_roles` requires every listed role, and `prevent_self_approval` defaults to true for signed decisions. Any identity or role restrictions require signatures.

## Establish the project trust root

```bash
aether trust keygen --id release-maintainer
aether trust register --id release-maintainer --public-key .aether/keys/release-maintainer.public.pem --roles maintainer,security
aether trust list
aether trust validate
```

The command creates an Ed25519 private key under `.aether/keys/` with owner-only file permissions and writes the public key into `.aether/trust/approvers.json` when registered. Private keys are Git-ignored and must remain secret. The public trust registry is project configuration; protect its changes with branch protection, code review, and trusted repository administration.

Use a separate identity ID for each key rotation or role-assignment change. Do not replace a public key or edit roles for an existing identity: the signed role snapshot is checked against the immutable role assignments in the trust registry. Set an identity's `active` flag to false to prevent new approvals while retaining its public key and roles for replay verification.

## CLI lifecycle

```bash
aether workflow run workflows/feature.yaml
aether workflow status <run-id>

# Optional gates can be requested:
aether workflow request-approval <run-id> --file workflows/feature.yaml --stage protected-change --by change-author

# Signed approval/rejection:
aether workflow approve <run-id> --file workflows/feature.yaml --stage protected-change --by release-maintainer --key .aether/keys/release-maintainer.private.pem --reason "Scope reviewed"
aether workflow reject <run-id> --file workflows/feature.yaml --stage protected-change --by release-maintainer --key .aether/keys/release-maintainer.private.pem --reason "Reduce the write scope"
```

Approval moves a stage to `ready`; rejection moves it to `blocked` and requires a reason. A rejected stage must receive a new approval request before it can continue. Earlier requests and decisions remain in the event history.

## Signature and authorization model

An Ed25519 signature covers the approval ID, immutable action digest, policy version, decision status, reviewer identity, decision timestamp, optional reason, and key ID. The signer must match the `--by` identity and their private key must correspond to the registered public key. Core checks that the identity is active, allowed by the stage policy, holds every required role, and is not the requester unless self-approval is explicitly allowed.

The signature is verified when the decision is accepted and again when the event log is replayed. Historical verification uses the retained public key even if the identity has since been disabled. Keep old public keys in the registry during key rotation; revoke future signing by setting `active: false`.

## Trust boundaries and limitations

- The project trust registry is the local root of trust. Protect it with protected branches, code review, and controlled repository administration.
- The CLI does not connect to an external identity provider or attest a person's legal identity. A signed key proves control of the registered private key, not who is physically using it.
- Private keys are unencrypted PEM files with owner-only permissions. Prefer a managed secret store or hardware-backed key workflow for high-value deployments.
- A local user able to replace the trust registry and runtime event log can alter local verification. This does not replace protected remote audit storage.
- Approval only gates Aether workflow state. It does not provide OS sandboxing, deployment credentials, policy quorum, or authorize external production actions.
- Unsigned legacy approvals remain supported only when a stage does not require a signature; `--by` on such a stage remains an unauthenticated audit label.
