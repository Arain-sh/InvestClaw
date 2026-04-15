export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  modelRef?: string | null;
  overrideModelRef?: string | null;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef?: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}

export interface AgentWorkspaceEntry {
  name: string;
  kind: 'directory' | 'file' | 'symlink';
  relativePath: string;
  hostPath: string;
  containerPath: string;
  extension: string;
  size: number;
  modifiedAt: string;
}

export interface AgentWorkspaceListing {
  agentId: string;
  agentName: string;
  configuredPath: string;
  hostPath: string;
  containerRoot: string;
  exists: boolean;
  currentRelativePath: string;
  currentHostPath: string;
  currentContainerPath: string;
  parentRelativePath: string | null;
  entries: AgentWorkspaceEntry[];
}

export interface AgentWorkspaceFilePreview {
  agentId: string;
  agentName: string;
  configuredPath: string;
  hostPath: string;
  containerRoot: string;
  exists: boolean;
  name: string;
  relativePath: string;
  containerPath: string;
  extension: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  kind: 'text' | 'image' | 'binary';
  content?: string;
  dataUrl?: string;
  truncated?: boolean;
}
