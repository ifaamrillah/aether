# Project Workflow Bundle

Aether installs its maintained workflow definitions under `workflows/aether/` in the target project. Root-level `workflows/` remains user-owned.

## Bundle rules

- Every YAML workflow is structurally and semantically validated before any files are installed.
- Workflow IDs must be unique within the bundle.
- Symbolic links and non-regular filesystem entries are rejected.
- The original relative directory structure is retained.
- Every installed file is tracked in `.aether/managed-files.json` with a SHA-256 checksum and source path.
- Existing untracked files are preserved and reported as conflicts.
- Aether-managed files that differ from their recorded checksum are treated as user-modified and preserved.
- `aether update` refreshes only unchanged managed files.
- `aether uninstall` removes only managed files whose current checksum still matches; `.aether/config.yaml` remains.

## Default workflow set

| Workflow ID | File | Purpose |
|---|---|---|
| `feature-development` | `feature.yaml` | Scoped feature delivery |
| `bug-fix` | `bug-fix.yaml` | Diagnose and fix defects |
| `refactoring` | `refactoring.yaml` | Internal restructuring with behavior preservation |
| `security-remediation` | `security-remediation.yaml` | Remediate a security finding |
| `documentation-update` | `documentation-update.yaml` | Update documentation against implementation |
| `project-onboarding` | `project-onboarding.yaml` | Build a grounded greenfield/brownfield baseline |

## Commands

```bash
aether workflow list
aether workflow validate workflows/aether/feature.yaml
aether workflow run workflows/aether/feature.yaml --input 'feature_description=Add account settings'
aether update
```

Use `aether init --dry-run` to inspect the proposed installation without writing project files. To source a different workflow collection, pass `--workflows <directory>`; it is validated using the same rules.

The current workflows create human-mediated handoffs for ready stages. They do not cause platform agents to launch automatically.
