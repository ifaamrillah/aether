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

// createRequire handles Ajv's CommonJS-compatible exports under NodeNext.
const Ajv2020 = unwrapDefault<AjvConstructor>(
  require("ajv/dist/2020.js"),
);
const addFormats = unwrapDefault<AddFormats>(
  require("ajv-formats"),
);

export interface SchemaValidationIssue {
  path: string;
  keyword: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationIssue[];
}

function loadSchema(name: string): object {
  const fileUrl = new URL(`../json-schema/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileUrl, "utf8")) as object;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

ajv.addSchema(loadSchema("common.schema.json"));

const validateWorkflow = ajv.compile(loadSchema("workflow.schema.json"));

/**
 * Validates the structural contract of a workflow definition.
 * Cross-reference and DAG checks belong to the Core semantic validator.
 */
export function validateWorkflowDefinition(
  value: unknown,
): SchemaValidationResult {
  const valid = validateWorkflow(value);

  return {
    valid,
    errors: (validateWorkflow.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message ?? "Schema validation failed.",
    })),
  };
}
