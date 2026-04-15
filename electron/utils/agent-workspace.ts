import { isUtf8 } from 'node:buffer';
import { constants } from 'node:fs';
import { access, lstat, open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { extname, join, posix, resolve } from 'node:path';
import type { AgentSummary } from './agent-config';
import { listAgentsSnapshot } from './agent-config';
import { expandPath } from './paths';

const CONTAINER_WORKSPACE_ROOT = '/workspace';
const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 2 * 1024 * 1024;

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.bash': 'text/x-shellscript',
  '.c': 'text/x-c',
  '.cc': 'text/x-c',
  '.cpp': 'text/x-c',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.go': 'text/x-go',
  '.gif': 'image/gif',
  '.h': 'text/x-c',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.java': 'text/x-java-source',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsx': 'text/jsx',
  '.md': 'text/markdown',
  '.mjs': 'text/javascript',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.rs': 'text/x-rust',
  '.sh': 'text/x-shellscript',
  '.sql': 'text/x-sql',
  '.svg': 'image/svg+xml',
  '.toml': 'application/toml',
  '.ts': 'text/typescript',
  '.tsx': 'text/tsx',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
};

type WorkspaceNodeKind = 'directory' | 'file' | 'symlink';
type WorkspacePreviewKind = 'text' | 'image' | 'binary';

export interface AgentWorkspaceInfo {
  agentId: string;
  agentName: string;
  configuredPath: string;
  hostPath: string;
  containerRoot: string;
  exists: boolean;
}

export interface AgentWorkspaceEntry {
  name: string;
  kind: WorkspaceNodeKind;
  relativePath: string;
  hostPath: string;
  containerPath: string;
  extension: string;
  size: number;
  modifiedAt: string;
}

export interface AgentWorkspaceListing extends AgentWorkspaceInfo {
  currentRelativePath: string;
  currentHostPath: string;
  currentContainerPath: string;
  parentRelativePath: string | null;
  entries: AgentWorkspaceEntry[];
}

export interface AgentWorkspaceFilePreview extends AgentWorkspaceInfo {
  name: string;
  relativePath: string;
  hostPath: string;
  containerPath: string;
  extension: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  kind: WorkspacePreviewKind;
  content?: string;
  dataUrl?: string;
  truncated?: boolean;
}

function getMimeType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  return EXTENSION_MIME_MAP[extension] || 'application/octet-stream';
}

function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/toml'
    || mimeType === 'application/xml'
    || mimeType === 'application/yaml';
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function normalizeRelativeWorkspacePath(input: string | null | undefined): string {
  const value = (input || '').trim();
  if (!value) return '';

  const stack: string[] = [];
  for (const segment of value.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) {
        throw new Error('Path escapes the workspace root');
      }
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  return stack.join('/');
}

function toContainerPath(relativePath: string): string {
  const normalizedRelativePath = normalizeRelativeWorkspacePath(relativePath);
  return normalizedRelativePath
    ? posix.join(CONTAINER_WORKSPACE_ROOT, normalizedRelativePath)
    : CONTAINER_WORKSPACE_ROOT;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readFilePreviewBytes(targetPath: string, limit: number): Promise<Buffer> {
  const fileHandle = await open(targetPath, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await fileHandle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
}

async function getAgentWorkspace(agentId: string): Promise<{ info: AgentWorkspaceInfo; agent: AgentSummary }> {
  const snapshot = await listAgentsSnapshot();
  const agent = snapshot.agents.find((item) => item.id === agentId);
  if (!agent) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  const hostPath = expandPath(agent.workspace);
  return {
    agent,
    info: {
      agentId: agent.id,
      agentName: agent.name,
      configuredPath: agent.workspace,
      hostPath,
      containerRoot: CONTAINER_WORKSPACE_ROOT,
      exists: await pathExists(hostPath),
    },
  };
}

async function assertWorkspaceRoot(info: AgentWorkspaceInfo): Promise<string> {
  const resolvedRoot = resolve(info.hostPath);
  if (!(await pathExists(resolvedRoot))) {
    throw new Error(`Workspace path does not exist: ${info.hostPath}`);
  }

  const rootStats = await lstat(resolvedRoot);
  if (rootStats.isSymbolicLink()) {
    throw new Error('Workspace root cannot be a symbolic link');
  }
  if (!rootStats.isDirectory()) {
    throw new Error('Workspace path must be a directory');
  }

  return await realpath(resolvedRoot);
}

async function resolveWorkspaceTarget(
  info: AgentWorkspaceInfo,
  relativePath: string,
): Promise<{ normalizedRelativePath: string; targetPath: string; rootPath: string }> {
  const rootPath = await assertWorkspaceRoot(info);
  const normalizedRelativePath = normalizeRelativeWorkspacePath(relativePath);
  const targetPath = normalizedRelativePath
    ? resolve(rootPath, normalizedRelativePath)
    : rootPath;

  if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}/`) && !targetPath.startsWith(`${rootPath}\\`)) {
    throw new Error('Path escapes the workspace root');
  }

  const targetStats = await lstat(targetPath);
  if (targetStats.isSymbolicLink()) {
    throw new Error('Workspace explorer does not follow symbolic links');
  }

  const realTargetPath = await realpath(targetPath);
  if (realTargetPath !== rootPath && !realTargetPath.startsWith(`${rootPath}/`) && !realTargetPath.startsWith(`${rootPath}\\`)) {
    throw new Error('Resolved path escapes the workspace root');
  }

  return {
    normalizedRelativePath,
    targetPath: realTargetPath,
    rootPath,
  };
}

function createBaseListing(
  info: AgentWorkspaceInfo,
  currentRelativePath: string,
): Omit<AgentWorkspaceListing, 'currentHostPath' | 'entries'> & { entries: AgentWorkspaceEntry[] } {
  return {
    ...info,
    currentRelativePath,
    currentContainerPath: toContainerPath(currentRelativePath),
    parentRelativePath: currentRelativePath.includes('/')
      ? currentRelativePath.slice(0, currentRelativePath.lastIndexOf('/'))
      : (currentRelativePath ? '' : null),
    entries: [],
  };
}

export async function listAgentWorkspaceDirectory(
  agentId: string,
  relativePath?: string | null,
): Promise<AgentWorkspaceListing> {
  const { info } = await getAgentWorkspace(agentId);
  const normalizedRelativePath = normalizeRelativeWorkspacePath(relativePath);

  if (!info.exists) {
    return {
      ...createBaseListing(info, normalizedRelativePath),
      currentHostPath: info.hostPath,
      entries: [],
    };
  }

  const { targetPath, rootPath } = await resolveWorkspaceTarget(info, normalizedRelativePath);
  const targetStats = await stat(targetPath);
  if (!targetStats.isDirectory()) {
    throw new Error('Workspace path is not a directory');
  }

  const dirEntries = await readdir(targetPath, { withFileTypes: true });
  const entries = await Promise.all(dirEntries.map(async (entry) => {
    const entryRelativePath = normalizedRelativePath
      ? `${normalizedRelativePath}/${entry.name}`
      : entry.name;
    const entryHostPath = join(rootPath, entryRelativePath);
    const entryStats = await lstat(entryHostPath);
    const kind: WorkspaceNodeKind = entryStats.isSymbolicLink()
      ? 'symlink'
      : (entry.isDirectory() ? 'directory' : 'file');

    return {
      name: entry.name,
      kind,
      relativePath: entryRelativePath,
      hostPath: entryHostPath,
      containerPath: toContainerPath(entryRelativePath),
      extension: extname(entry.name).toLowerCase(),
      size: entryStats.size,
      modifiedAt: entryStats.mtime.toISOString(),
    } satisfies AgentWorkspaceEntry;
  }));

  entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      if (left.kind === 'directory') return -1;
      if (right.kind === 'directory') return 1;
      if (left.kind === 'symlink') return 1;
      if (right.kind === 'symlink') return -1;
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  return {
    ...createBaseListing(info, normalizedRelativePath),
    currentHostPath: targetPath,
    entries,
  };
}

export async function readAgentWorkspaceFilePreview(
  agentId: string,
  relativePath?: string | null,
): Promise<AgentWorkspaceFilePreview> {
  const { info } = await getAgentWorkspace(agentId);
  if (!info.exists) {
    throw new Error(`Workspace path does not exist: ${info.hostPath}`);
  }

  const { normalizedRelativePath, targetPath } = await resolveWorkspaceTarget(info, relativePath || '');
  if (!normalizedRelativePath) {
    throw new Error('File path is required');
  }

  const fileStats = await stat(targetPath);
  if (!fileStats.isFile()) {
    throw new Error('Selected workspace entry is not a file');
  }

  const mimeType = getMimeType(targetPath);
  const preview: AgentWorkspaceFilePreview = {
    ...info,
    name: normalizedRelativePath.split('/').pop() || normalizedRelativePath,
    relativePath: normalizedRelativePath,
    hostPath: targetPath,
    containerPath: toContainerPath(normalizedRelativePath),
    extension: extname(targetPath).toLowerCase(),
    mimeType,
    size: fileStats.size,
    modifiedAt: fileStats.mtime.toISOString(),
    kind: 'binary',
  };

  if (isImageMimeType(mimeType)) {
    preview.kind = 'image';
    if (fileStats.size <= MAX_IMAGE_PREVIEW_BYTES) {
      const fileBuffer = await readFile(targetPath);
      preview.dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
    }
    return preview;
  }

  const previewBuffer = await readFilePreviewBytes(targetPath, MAX_TEXT_PREVIEW_BYTES);
  if (!isTextMimeType(mimeType) && !isUtf8(previewBuffer.subarray(0, Math.min(previewBuffer.length, 8192)))) {
    return preview;
  }

  preview.kind = 'text';
  preview.content = previewBuffer.toString('utf8');
  preview.truncated = fileStats.size > MAX_TEXT_PREVIEW_BYTES;
  return preview;
}
