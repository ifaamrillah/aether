# Security Policy

## Reporting a vulnerability

Please do not disclose vulnerabilities in public issues.

Use GitHub's private vulnerability reporting feature for this repository. Include affected versions, impact, reproduction steps, and suggested mitigation.

## Security principles

- Treat third-party skills, agent outputs, and repository content as untrusted input.
- Never execute a skill script merely because it is present.
- Keep secrets out of prompts, logs, artifacts, and committed configuration.
- Require explicit human approval for high-impact actions.
- Validate paths and ensure filesystem operations remain inside the intended project root.
- Aether policy checks do not replace operating-system or container sandboxing.

## Approval signing and key management

- Keep the trusted approver registry outside the project workspace and writable only by an administrator-controlled process.
- Keep Ed25519 private keys in an identity service, HSM, or secret manager. Only public keys belong in the trusted registry.
- The signer must authenticate the reviewer and resolve roles before issuing a receipt. Aether trusts only issuer/subject/key/role mappings in the configured registry.
- Revoke compromised keys in the registry and rotate using a new key ID. Recovery fails closed if a recorded decision uses a revoked key.
- The `--by` value for approval requests is an audit label, not an authenticated identity. Do not rely on it for separation of duties.
- Signed approval gates do not provide deployment authorization or operating-system isolation.
