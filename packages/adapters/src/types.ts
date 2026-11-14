import type { StageTaskContract } from "@aether/core";

export type AdapterId =
  | "generic"
  | "claude-code"
  | "codex"
  | "opencode"
  | "gemini-cli"
  | "antigravity";
export type CapabilityStatus = "native" | "supported" | "degraded" | "unsupported";

export interface CapabilityDescriptor {
  id: string;
  status: CapabilityStatus;
  limitations?: string[];
}

export interface AdapterDescriptor {
  schema_version: 1;
  id: AdapterId;
  name: string;
  adapter_version: string;
  handoff_mode: "human-mediated";
  supported_skill_format: string[];
  capabilities: CapabilityDescriptor[];
  project_markers: string[];
}

export interface AgentAdapter {
  descriptor: AdapterDescriptor;
  detect(projectRoot: string): Promise<boolean>;
  renderHandoff(task: StageTaskContract): string;
}
