import { readFileSync } from "node:fs";
import * as Ajv2020Module from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";

const Ajv2020 = Ajv2020Module.default;
const addFormats = addFormatsModule.default;
import type { ErrorObject } from "ajv";

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
    errors: (validateWorkflow.errors ?? []).map((error: ErrorObject) => ({
      path: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message ?? "Schema validation failed.",
    })),
  };
}
