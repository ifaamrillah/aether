import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ErrorObject } from "ajv";

const require = createRequire(import.meta.url);

type CompiledValidator = ((value: unknown) => boolean) & {
  errors?: ErrorObject[] | null;
};

interface AjvInstance {
  addSchema(schema: object): AjvInstance;
  compile(schema: object): CompiledValidator;
}

type AjvConstructor = new (options: {
  allErrors: boolean;
  strict: boolean;
}) => AjvInstance;

type AddFormats = (ajv: AjvInstance) => void;

function unwrapDefault<T>(moduleValue: unknown): T {
  if (
    typeof moduleValue === "object" &&
    moduleValue !== null &&
    "default" in moduleValue
  ) {
    return (moduleValue as { default: T }).default;
  }

  return moduleValue as T;
}

const Ajv2020 = unwrapDefault<AjvConstructor>(require("ajv/dist/2020.js"));
const addFormats = unwrapDefault<AddFormats>(require("ajv-formats"));

export interface SchemaValidationIssue {
  path: string;
  keyword: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationIssue[];
}

export type ContractSchemaName =
  | "workflow"
  | "run"
  | "event"
  | "task"
  | "approval"
  | "project-config"
  | "adapter"
  | "delegation"
  | "task-result"
  | "approval-decision"
  | "trusted-approvers";

function loadSchema(name: string): object {
  const fileUrl = new URL("../json-schema/" + name + ".schema.json", import.meta.url);
  return JSON.parse(readFileSync(fileUrl, "utf8")) as object;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(loadSchema("common"));

const schemaNames: ContractSchemaName[] = [
  "workflow",
  "run",
  "event",
  "task",
  "approval",
  "project-config",
  "adapter",
  "delegation",
  "task-result",
  "approval-decision",
  "trusted-approvers",
];

const validators = new Map<ContractSchemaName, CompiledValidator>();
for (const name of schemaNames) {
  validators.set(name, ajv.compile(loadSchema(name)));
}

export function validateAetherContract(
  schemaName: ContractSchemaName,
  value: unknown,
): SchemaValidationResult {
  const validator = validators.get(schemaName);
  if (!validator) {
    return {
      valid: false,
      errors: [{ path: "/", keyword: "schema", message: "Unknown Aether contract schema." }],
    };
  }

  const valid = validator(value);
  return {
    valid,
    errors: (validator.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message ?? "Schema validation failed.",
    })),
  };
}

/**
 * Validates the structural contract of a workflow definition.
 * Cross-reference and DAG checks belong to the Core semantic validator.
 */
export function validateWorkflowDefinition(
  value: unknown,
): SchemaValidationResult {
  return validateAetherContract("workflow", value);
}

export function validateDelegationContract(
  value: unknown,
): SchemaValidationResult {
  return validateAetherContract("delegation", value);
}

export function validateTaskResultSubmission(
  value: unknown,
): SchemaValidationResult {
  return validateAetherContract("task-result", value);
}

export function validateAgentAdapterDescriptor(
  value: unknown,
): SchemaValidationResult {
  return validateAetherContract("adapter", value);
}

export function validateWorkflowRunSnapshot(
  value: unknown,
): SchemaValidationResult {
  return validateAetherContract("run", value);
}

export function validateApprovalDecisionReceipt(value: unknown): SchemaValidationResult {
  return validateAetherContract("approval-decision", value);
}

export function validateTrustedApproverStore(value: unknown): SchemaValidationResult {
  return validateAetherContract("trusted-approvers", value);
}
