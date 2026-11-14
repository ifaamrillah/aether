import { parse as parseYaml } from "yaml";

export interface WorkflowRunOptions {
  inputs: Record<string, unknown>;
  projectId?: string;
}

/**
 * Parses repeatable --input name=value flags. Values use YAML scalar syntax,
 * allowing booleans and numbers without adding a second type-coercion system.
 */
export function parseWorkflowRunOptions(args: string[]): WorkflowRunOptions {
  const inputs: Record<string, unknown> = {};
  let projectId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];

    if (flag === "--input") {
      const assignment = args[index + 1];
      if (!assignment) {
        throw new Error("Missing value after --input. Expected name=value.");
      }
      index += 1;

      const separator = assignment.indexOf("=");
      if (separator <= 0) {
        throw new Error('Invalid --input value "' + assignment + '". Expected name=value.');
      }

      const name = assignment.slice(0, separator).trim();
      const rawValue = assignment.slice(separator + 1);
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
        throw new Error('Invalid workflow input name "' + name + '".');
      }
      if (Object.prototype.hasOwnProperty.call(inputs, name)) {
        throw new Error('Workflow input "' + name + '" was provided more than once.');
      }

      try {
        inputs[name] = parseYaml(rawValue, { uniqueKeys: true });
      } catch (error) {
        throw new Error(
          'Unable to parse value for input "' + name + '": ' +
            (error instanceof Error ? error.message : "invalid YAML value"),
        );
      }
      continue;
    }

    if (flag === "--project-id") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value after --project-id.");
      }
      if (projectId !== undefined) {
        throw new Error("--project-id can only be provided once.");
      }
      projectId = value;
      index += 1;
      continue;
    }

    throw new Error('Unknown workflow run option "' + flag + '".');
  }

  return projectId === undefined ? { inputs } : { inputs, projectId };
}
