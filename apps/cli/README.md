# @aether/cli

The Aether command-line interface.

## Requirements

- Node.js 22 or newer.
- npm or pnpm.

## Install

After the first public npm release:

```bash
npm install --global @aether/cli
```

## Initialize a project

```bash
aether init --platform codex --platform claude-code
aether doctor
aether workflow list
```

The published CLI includes the validated portable Agent Skills and workflow bundles. Project files are installed with a checksum manifest; user-owned or locally modified files are preserved.

See the [Aether repository](https://github.com/ifaamrillah/aether) for workflows, architecture, security boundaries, and development instructions.

## Approval gates

Stages may declare `approval: { mode: required, risk: high }` to pause before handoff. Use `aether workflow approve` or `reject` with an explicit `--by` identity and file/stage binding. Optional gates can be requested with `aether workflow request-approval`.

See the [approval gate guide](../../docs/architecture/approval-gates.md).

## Trusted approval identities

Use `aether trust keygen` to create an Ed25519 key pair, then `aether trust register` to add the public key and role assignments to `.aether/trust/approvers.json`. Private keys are written to the Git-ignored `.aether/keys/` directory with owner-only permissions. For signed approval stages, pass `--key <private-key.pem>` with the trusted identity ID in `--by`. See the [approval gate guide](../../docs/architecture/approval-gates.md).
