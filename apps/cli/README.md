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

## Trusted approval decisions

Approval decisions require a signed Ed25519 receipt; unsigned `--by` decision values are rejected. Set `AETHER_TRUSTED_APPROVERS_FILE` to an absolute, non-symlink registry outside the project workspace. Registry roles authorize receipts; the `--by` flag on `request-approval` remains an unauthenticated audit label.

See the [trusted approval guide](../../docs/architecture/approval-gates.md) for registry format, receipt signing, role mapping, and security limitations.
