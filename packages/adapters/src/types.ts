import type { StageTaskContract } from "@aether/core";

export type AdapterId =
  | "generic"
  | "claude-code"
  | "codex"
  | "opencode"
  | "gemini-cli"
  | "antigravity";
export type CapabilityStatus = "native" | "supported" | "degraded" | "unsupported";
export type AdapterExecutionMode = "handoff-only" | "interactive-cli";

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
  execution_mode: AdapterExecutionMode;
  supported_skill_format: string[];
  capabilities: CapabilityDescriptor[];
  project_markers: string[];
  skill_install_path: string;
}

export interface AgentLaunchSpec {
  adapter_id: AdapterId;
  command: string;
  args: string[];
  permission_notes: string[];
}

export interface AgentAdapter {
  descriptor: AdapterDescriptor;
  detect(projectRoot: string): Promise<boolean>;
  renderHandoff(task: StageTaskContract): string;
  buildLaunch(task: StageTaskContract, handoffPath: string): AgentLaunchSpec | undefined;
}
