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
