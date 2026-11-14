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
