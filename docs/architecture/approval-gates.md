# Trusted Workflow Approval Gates

Aether pauses protected stages until a detached, signed approval receipt has been verified against an externally managed public-key registry. This is an authorization boundary for workflow progression, not a host sandbox or deployment permission system.

## Stage policy

```yaml
- id: production-change
  skill: implementation
  required: true
  approval:
    mode: required
    risk: critical
    required_roles: ["release-manager", "security-approver"]
```

`mode` supports `none`, `optional`, or `required`. A required gate is created when dependencies and conditions are satisfied; an optional stage starts ready and may later receive a gate with `workflow request-approval`. `risk` is descriptive metadata. `required_roles` defaults to `[`approver`]`; a configured key must hold at least one role required by that stage.

`request-approval --by <label>` stores an operator-supplied audit label. It is explicitly not an authenticated identity. Aether does not claim separation of duties until requester identity is authenticated.

## External trusted approver registry

Set `AETHER_TRUSTED_APPROVERS_FILE` to an absolute path outside the project workspace. On POSIX systems the registry must not be group- or world-writable. The CLI rejects symlinks, non-regular files, relative paths, and registry files inside the project root.

Example registry:

```json
{
  "schema_version": 1,
  "keys": [{
    "key_id": "release-maintainer-2026-01",
    "issuer": "https://identity.example.com",
    "subject": "alice@example.com",
    "algorithm": "Ed25519",
    "public_key_pem": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
    "roles": ["approver", "release-manager"],
    "status": "active"
  }]
}
```

The registry, not the receipt, grants roles. Key IDs must be unique. Set `status` to `revoked` to reject future decisions and recovery of decision events signed by that key. Rotate keys by adding a new key ID and retiring the old one through the registry-management process.

## Signed decision receipts

The pending `approval` object is stored in `.aether/runs/<run-id>/events.jsonl` in the `stage.transitioned` event whose target status is `awaiting_approval`. The signer obtains `approval.id` and `approval.action_digest` from that event.

A receipt has this shape:

```json
{
  "schema_version": 1,
  "approval_id": "approval_...",
  "action_digest": "<64 lowercase hex characters>",
  "decision": "approved",
  "issuer": "https://identity.example.com",
  "subject": "alice@example.com",
  "key_id": "release-maintainer-2026-01",
  "issued_at": "2026-11-15T07:00:00.000Z",
  "expires_at": "2026-11-15T07:10:00.000Z",
  "signature": "<base64url Ed25519 signature>"
}
```

A rejection must include a non-empty `reason`. The signature covers every receipt field except `signature`, encoded as canonical JSON with recursively sorted object keys. `@aether/core` exports `canonicalizeApprovalDecision` so an external signing service can use the same representation:

```ts
import { sign } from "node:crypto";
import { canonicalizeApprovalDecision } from "@aether/core";

const unsigned = {
  schema_version: 1, approval_id, action_digest, decision: "approved",
  issuer, subject, key_id, issued_at, expires_at,
};
const receipt = {
  ...unsigned,
  signature: sign(null, Buffer.from(canonicalizeApprovalDecision(unsigned)), privateKey)
    .toString("base64url"),
};
```

The signing private key belongs only in the identity service, HSM, or secret manager. Never commit it or place it in the project workspace. The receipt must match the pending approval ID and action digest, be issued after the request, not be expired, and have a lifetime no longer than 15 minutes. The verifier permits at most 60 seconds of clock skew.

## CLI

```bash
# Start the workflow and inspect the pending approval event
aether workflow run workflows/feature.yaml
aether workflow status <run-id>

# A requester label is for audit only
aether workflow request-approval <run-id> --file workflows/feature.yaml --stage production-change --by "change-request-42"

# Apply a signed receipt; the registry path is external to the workspace
AETHER_TRUSTED_APPROVERS_FILE=/secure/aether/trusted-approvers.json \\
  aether workflow approve <run-id> --file workflows/feature.yaml --stage production-change --receipt /secure/receipts/approval.json
AETHER_TRUSTED_APPROVERS_FILE=/secure/aether/trusted-approvers.json \\
  aether workflow reject <run-id> --file workflows/feature.yaml --stage production-change --receipt /secure/receipts/rejection.json
```

The old `--by` / `--reason` decision form is rejected. Only the authenticated issuer/subject derived from the trusted key registry is stored as `decided_by`.

## Migration from unsigned approval records

Approval records created under the earlier `aether-approval-v1` contract do not contain signed decision receipts and cannot be approved or rejected through this version. Do not edit their event log to fabricate a receipt. Start a new workflow run (or submit a fresh optional approval request under the v2 workflow definition) so Aether creates a v2 action digest, then obtain a new signed receipt from the external approval service.
## Authorization and recovery behavior

- Public-key identity is bound to an exact `key_id`, `issuer`, and `subject`.
- Roles are taken from the trusted registry; the receipt cannot self-assign roles.
- The receipt's Ed25519 signature covers the decision, approval ID, action digest, identity, issue/expiry timestamps, and optional reason.
- Approval records use policy version `aether-approval-v2` and include the configured required roles in the action digest context.
- The generic stage-transition API verifies signed receipts too; it cannot bypass the trusted authorizer.
- Recovery re-verifies signatures against the current registry. Unknown or revoked keys, invalid signatures, mismatched digests, expired receipts, or removed roles fail closed.

## Trust boundaries and remaining work

- The trusted registry is a local public-key trust anchor. Its path and write permissions must be controlled by the operator outside the repository.
- Aether verifies the key-to-subject mapping and roles in that registry. Authentication before signing is the responsibility of the external identity/approval service; Aether does not implement login, OIDC discovery, or token exchange.
- Requester identities remain audit labels, so separation-of-duties enforcement is not implemented.
- Quorum approvals, time-based expiry scheduling, external policy engines, approval notifications, and an authenticated requester flow remain future work.
- Signed approval gates control Aether workflow state. They do not provide OS/container isolation, grant credentials, or authorize production deployments.
