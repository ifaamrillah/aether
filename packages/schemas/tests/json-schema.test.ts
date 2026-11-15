import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

type JsonSchema = {
  $id: string;
  $schema: string;
  [key: string]: unknown;
};

const schemaDirectory = fileURLToPath(new URL("../json-schema/", import.meta.url));

const schemas: JsonSchema[] = readdirSync(schemaDirectory)
  .filter((name) => name.endsWith(".schema.json"))
  .sort()
  .map((name) =>
    JSON.parse(
      readFileSync(new URL(`../json-schema/${name}`, import.meta.url), "utf8"),
    ) as JsonSchema,
  );

describe("canonical JSON Schemas", () => {
  it("uses JSON Schema Draft 2020-12 and unique identifiers", () => {
    const identifiers = schemas.map((schema) => schema.$id);

    expect(schemas.length).toBeGreaterThan(0);
    expect(new Set(identifiers).size).toBe(identifiers.length);

    for (const schema of schemas) {
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.$id).toMatch(/^https:\/\/aether\.dev\/schemas\/.+\.schema\.json$/);
    }
  });

  it("compiles every schema and resolves local shared references", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);

    for (const schema of schemas) {
      ajv.addSchema(schema);
    }

    for (const schema of schemas) {
      expect(ajv.getSchema(schema.$id)).toBeDefined();
    }
  });

  it("validates portable delegation and task result contracts", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    for (const schema of schemas) ajv.addSchema(schema);

    const validateDelegation = ajv.getSchema(
      "https://aether.dev/schemas/delegation.schema.json",
    );
    const validateTaskResult = ajv.getSchema(
      "https://aether.dev/schemas/task-result.schema.json",
    );

    expect(validateDelegation).toBeDefined();
    expect(validateTaskResult).toBeDefined();

    expect(validateDelegation?.({
      schema_version: 1,
      task_id: "task_run_123_discovery",
      run_id: "run_123",
      workflow_id: "feature-development",
      workflow_version: 1,
      stage_id: "discovery",
      title: "Discover existing behavior",
      objective: "Inspect the project and report relevant constraints.",
      suggested_role: "Analyst",
      adapter_id: "generic",
      dependencies: [],
      file_scope: {
        read_paths: ["src/**"],
        write_paths: ["docs/discovery/**"]
      },
      output_paths: [".aether/handoffs/run_123/discovery/output/**"],
      acceptance_criteria: ["Record findings", "Attach evidence"],
      expected_result_path: ".aether/handoffs/run_123/discovery/result.json",
      created_at: "2026-11-15T01:00:00.000Z"
    })).toBe(true);

    expect(validateTaskResult?.({
      schema_version: 1,
      task_id: "task_run_123_discovery",
      run_id: "run_123",
      stage_id: "discovery",
      summary: "Reviewed the existing project.",
      changed_files: ["docs/discovery/summary.md"],
      evidence: [{
        path: ".aether/handoffs/run_123/discovery/output/report.md",
        type: "documentation",
        result: "passed",
        summary: "Discovery notes"
      }]
    })).toBe(true);

    expect(validateTaskResult?.({
      schema_version: 1,
      task_id: "task_run_123_discovery",
      run_id: "run_123",
      stage_id: "discovery",
      summary: "Missing evidence",
      changed_files: [],
      evidence: []
    })).toBe(false);
  });

  it("validates adapter execution modes without claiming native subagent execution", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    for (const schema of schemas) ajv.addSchema(schema);

    const validateAdapter = ajv.getSchema(
      "https://aether.dev/schemas/adapter.schema.json",
    );
    expect(validateAdapter).toBeDefined();

    expect(validateAdapter?.({
      schema_version: 1,
      id: "generic",
      name: "Generic Agent Handoff",
      adapter_version: "0.1.0",
      handoff_mode: "human-mediated",
      execution_mode: "handoff-only",
      supported_skill_format: ["agentskills"],
      project_markers: [],
      skill_install_path: ".agents/skills",
      capabilities: [
        { id: "agent_handoff", status: "supported" },
        { id: "interactive_execution", status: "unsupported" },
        { id: "native_subagents", status: "unsupported" }
      ]
    })).toBe(true);
  });

  it("validates a project trusted-approver registry structure", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    for (const schema of schemas) ajv.addSchema(schema);
    const validateTrust = ajv.getSchema("https://aether.dev/schemas/approver-trust.schema.json");
    expect(validateTrust).toBeDefined();
    expect(validateTrust?.({
      schema_version: 1,
      identities: [{
        id: "maintainer",
        public_key_pem: "-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\\n-----END PUBLIC KEY-----",
        roles: ["maintainer", "security"],
        active: true,
      }],
    })).toBe(true);
    expect(validateTrust?.({ schema_version: 1, identities: [{ id: "maintainer", public_key_pem: "invalid", roles: [], active: true }] })).toBe(false);
  });

  it("validates digest-bound workflow approval records", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    for (const schema of schemas) ajv.addSchema(schema);
    const validateApproval = ajv.getSchema("https://aether.dev/schemas/approval.schema.json");
    expect(validateApproval).toBeDefined();
    const approval = {
      schema_version: 1, id: "approval_123",
      action: {
        id: "stage-run_123-production-change", type: "workflow.stage.execute",
        target: "production-change", risk: "high", requested_by: "system",
        context: {
          run_id: "run_123", workflow_id: "release-workflow", workflow_version: 1,
          stage_id: "production-change",
          scope: { read_paths: ["src/**"], write_paths: ["src/**"] },
          acceptance_criteria: ["Review the implementation"],
        },
      },
      status: "pending", requested_at: "2026-11-15T01:00:00.000Z",
      requested_by: "system", policy_version: "aether-approval-v1",
      action_digest: "a".repeat(64),
    };
    expect(validateApproval?.(approval)).toBe(true);
    const signedApproval = {
      ...approval,
      status: "approved",
      decided_at: "2026-11-15T01:05:00.000Z",
      decided_by: "maintainer",
      decision_reason: "Reviewed.",
      decision_signature: {
        algorithm: "ed25519",
        key_id: "maintainer",
        roles: ["maintainer", "security"],
        signature: "A".repeat(86) + "==",
      },
    };
    expect(validateApproval?.(signedApproval)).toBe(true);
    const malformedSignature = {
      ...signedApproval,
      decision_signature: { ...signedApproval.decision_signature, algorithm: "rsa" },
    };
    expect(validateApproval?.(malformedSignature)).toBe(false);
    const withoutDigest = { ...approval } as Record<string, unknown>;
    delete withoutDigest.action_digest;
    expect(validateApproval?.(withoutDigest)).toBe(false);
  });
  it("accepts a minimal valid workflow definition", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);

    for (const schema of schemas) {
      ajv.addSchema(schema);
    }

    const validate = ajv.getSchema(
      "https://aether.dev/schemas/workflow.schema.json",
    );

    expect(validate).toBeDefined();
    expect(
      validate?.({
        schema_version: 1,
        id: "feature-development",
        version: 1,
        name: "Feature Development",
        description: "A minimal feature workflow.",
        inputs: [],
        stages: [
          {
            id: "implementation",
            skill: "implementation",
            required: true,
          },
        ],
        completion: {
          required_stages: ["implementation"],
        },
      }),
    ).toBe(true);
  });
});
