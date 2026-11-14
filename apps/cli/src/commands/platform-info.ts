import { createAgentAdapter, listAgentAdapters } from "@aether/adapters";
import type { AdapterDescriptor, AdapterId } from "@aether/adapters";

export interface AgentPlatformInspection {
  descriptor: AdapterDescriptor;
  detected: boolean;
}

/** Detects host project markers without inferring runtime capabilities from them. */
export async function inspectAgentPlatforms(
  projectRoot: string,
): Promise<AgentPlatformInspection[]> {
  const descriptors = listAgentAdapters();
  return Promise.all(
    descriptors.map(async (descriptor) => ({
      descriptor,
      detected: await createAgentAdapter(descriptor.id).detect(projectRoot),
    })),
  );
}

export function isAdapterId(value: string): value is AdapterId {
  return [
    "generic",
    "claude-code",
    "codex",
    "opencode",
    "gemini-cli",
    "antigravity",
  ].includes(value);
}
