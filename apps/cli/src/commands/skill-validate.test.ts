import { describe, expect, it } from "vitest";
import { validateSkillContent } from "./skill-validate.js";

const validSkill = `---
name: project-onboarding
description: Map an unfamiliar repository before making changes. Use when starting a new project.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
---
# Project Onboarding

Inspect instructions, manifests, source structure, tests, and relevant entry points.

Record confirmed facts and unresolved assumptions. Do not expose secrets or modify files during onboarding.
`;

describe("validateSkillContent", () => {
  it("accepts a valid portable Agent Skill", () => {
    const result = validateSkillContent(validSkill, "project-onboarding");
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("requires the name to match its directory", () => {
    const result = validateSkillContent(validSkill, "different-name");
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "name_directory_mismatch")).toBe(true);
  });

  it("rejects unsupported top-level Aether metadata", () => {
    const content = validSkill.replace(
      "license: MIT",
      "license: MIT\nversion: 1.0.0",
    );
    const result = validateSkillContent(content, "project-onboarding");
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "unsupported_frontmatter_field")).toBe(true);
  });

  it("rejects invalid skill names and empty descriptions", () => {
    const content = validSkill
      .replace("name: project-onboarding", "name: Project_Onboarding")
      .replace("description: Map an unfamiliar repository before making changes. Use when starting a new project.", "description: ' '");
    const result = validateSkillContent(content, "Project_Onboarding");
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "name_format")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "description_required")).toBe(true);
  });

  it("supports CRLF and reports malformed YAML", () => {
    const crlf = validSkill.replace(/\n/g, "\r\n");
    expect(validateSkillContent(crlf, "project-onboarding").valid).toBe(true);

    const malformed = validSkill.replace("name: project-onboarding", "name: [unclosed");
    const result = validateSkillContent(malformed, "project-onboarding");
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "frontmatter_yaml")).toBe(true);
  });

  it("rejects a skill without a body", () => {
    const content = `---
name: project-onboarding
description: Map an unfamiliar repository before making changes.
---
`;
    const result = validateSkillContent(content, "project-onboarding");
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "body_empty")).toBe(true);
  });
});
