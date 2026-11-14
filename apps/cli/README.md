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
