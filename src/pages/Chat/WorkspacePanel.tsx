import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronRight, FileCode2, FileImage, FileSymlink, FileText, Folder, FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { AgentWorkspaceEntry, AgentWorkspaceFilePreview, AgentWorkspaceListing } from '@/types/agent';
import { useTranslation } from 'react-i18next';

interface WorkspacePanelProps {
  agentId: string;
  agentName: string;
}

type PreviewMode = 'render' | 'source';

function buildWorkspaceQuery(path?: string | null): string {
  if (!path) return '';
  const params = new URLSearchParams({ path });
  return `?${params.toString()}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function createWorkspaceTestId(path: string): string {
  return encodeURIComponent(path || 'root').replace(/%/g, '').toLowerCase();
}

function isRenderableMarkdown(preview: AgentWorkspaceFilePreview | null): boolean {
  if (!preview || preview.kind !== 'text') return false;
  return preview.mimeType === 'text/markdown' || preview.extension === '.md';
}

function isRenderableHtml(preview: AgentWorkspaceFilePreview | null): boolean {
  if (!preview || preview.kind !== 'text') return false;
  return preview.mimeType === 'text/html' || preview.extension === '.html' || preview.extension === '.htm';
}

function EntryIcon({ entry }: { entry: AgentWorkspaceEntry }) {
  if (entry.kind === 'directory') {
    return <Folder className="h-4 w-4 text-primary/80" />;
  }
  if (entry.kind === 'symlink') {
    return <FileSymlink className="h-4 w-4 text-amber-500" />;
  }
  if (entry.extension === '.png' || entry.extension === '.jpg' || entry.extension === '.jpeg' || entry.extension === '.gif' || entry.extension === '.svg' || entry.extension === '.webp') {
    return <FileImage className="h-4 w-4 text-sky-500" />;
  }
  if (entry.extension === '.ts' || entry.extension === '.tsx' || entry.extension === '.js' || entry.extension === '.jsx' || entry.extension === '.json' || entry.extension === '.py' || entry.extension === '.go' || entry.extension === '.rs') {
    return <FileCode2 className="h-4 w-4 text-violet-500" />;
  }
  return <FileText className="h-4 w-4 text-foreground/65" />;
}

interface WorkspaceTreeNodeProps {
  entry: AgentWorkspaceEntry;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  folderLabel: string;
  onToggleDirectory: (entry: AgentWorkspaceEntry) => void;
  onOpenFile: (relativePath: string) => void;
}

const WorkspaceTreeNode = memo(function WorkspaceTreeNode({
  entry,
  depth,
  isExpanded,
  isSelected,
  folderLabel,
  onToggleDirectory,
  onOpenFile,
}: WorkspaceTreeNodeProps) {
  const isDirectory = entry.kind === 'directory';

  return (
    <div
      className="min-w-0"
      style={{ containIntrinsicSize: '44px auto' }}
    >
      <button
        type="button"
        data-testid={`workspace-entry-${createWorkspaceTestId(entry.relativePath)}`}
        onClick={() => {
          if (entry.kind === 'symlink') return;
          if (isDirectory) {
            onToggleDirectory(entry);
            return;
          }
          onOpenFile(entry.relativePath);
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-[1rem] px-3 py-2 text-left',
          'hover:bg-white/72 dark:hover:bg-white/[0.04]',
          isSelected && 'bg-white text-primary shadow-[0_1px_0_rgba(255,255,255,0.85)_inset,0_10px_24px_rgba(24,18,12,0.05)]',
          entry.kind === 'symlink' && 'cursor-not-allowed opacity-60',
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {isDirectory ? (
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-foreground/45 transition-transform', isExpanded && 'rotate-90')} />
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        {isDirectory ? (
          isExpanded ? <FolderOpen className="h-4 w-4 shrink-0 text-primary/80" /> : <Folder className="h-4 w-4 shrink-0 text-primary/80" />
        ) : (
          <EntryIcon entry={entry} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{entry.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {isDirectory ? folderLabel : formatBytes(entry.size)}
          </div>
        </div>
      </button>
    </div>
  );
});

export function WorkspacePanel({ agentId, agentName }: WorkspacePanelProps) {
  const { t } = useTranslation('chat');
  const [workspace, setWorkspace] = useState<AgentWorkspaceListing | null>(null);
  const [directoryEntries, setDirectoryEntries] = useState<Record<string, AgentWorkspaceEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const [loadingDirectories, setLoadingDirectories] = useState<Record<string, boolean>>({});
  const [directoryErrors, setDirectoryErrors] = useState<Record<string, string>>({});
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [preview, setPreview] = useState<AgentWorkspaceFilePreview | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('render');
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const loadDirectory = useCallback(async (relativePath = '', options?: { replace?: boolean }) => {
    const query = buildWorkspaceQuery(relativePath);
    const listing = await hostApiFetch<AgentWorkspaceListing>(
      `/api/agents/${encodeURIComponent(agentId)}/workspace${query}`,
    );

    setWorkspace((current) => current && !options?.replace ? current : listing);
    setDirectoryEntries((current) => ({
      ...current,
      [relativePath]: listing.entries,
    }));
    setDirectoryErrors((current) => {
      const next = { ...current };
      delete next[relativePath];
      return next;
    });

    return listing;
  }, [agentId]);

  const loadPreview = useCallback(async (relativePath: string) => {
    setLoadingPreview(true);
    setSelectedFilePath(relativePath);
    setPreviewMode('render');
    try {
      const query = buildWorkspaceQuery(relativePath);
      const result = await hostApiFetch<AgentWorkspaceFilePreview>(
        `/api/agents/${encodeURIComponent(agentId)}/workspace/file${query}`,
      );
      setPreview(result);
      setPreviewError(null);
    } catch (error) {
      setPreview(null);
      setPreviewError(String(error));
    } finally {
      setLoadingPreview(false);
    }
  }, [agentId]);

  const refreshWorkspace = useCallback(async () => {
    setLoadingRoot(true);
    setWorkspaceError(null);
    try {
      const expanded = Object.entries(expandedDirectories)
        .filter(([, isExpanded]) => isExpanded)
        .map(([path]) => path)
        .sort((left, right) => left.localeCompare(right));

      setDirectoryEntries({});
      const rootListing = await loadDirectory('', { replace: true });
      setWorkspace(rootListing);

      for (const path of expanded) {
        if (!path) continue;
        try {
          await loadDirectory(path);
        } catch (error) {
          setDirectoryErrors((current) => ({
            ...current,
            [path]: String(error),
          }));
        }
      }

      if (selectedFilePath) {
        await loadPreview(selectedFilePath);
      }
    } catch (error) {
      setWorkspaceError(String(error));
    } finally {
      setLoadingRoot(false);
    }
  }, [expandedDirectories, loadDirectory, loadPreview, selectedFilePath]);

  useEffect(() => {
    setWorkspace(null);
    setDirectoryEntries({});
    setExpandedDirectories({});
    setLoadingDirectories({});
    setDirectoryErrors({});
    setSelectedFilePath(null);
    setPreview(null);
    setPreviewMode('render');
    setWorkspaceError(null);
    setPreviewError(null);
    setLoadingRoot(true);
    loadDirectory('', { replace: true })
      .then((rootListing) => {
        setWorkspace(rootListing);
      })
      .catch((error) => {
        setWorkspaceError(String(error));
      })
      .finally(() => {
        setLoadingRoot(false);
      });
  }, [agentId, loadDirectory]);

  const toggleDirectory = useCallback(async (entry: AgentWorkspaceEntry) => {
    const isExpanded = Boolean(expandedDirectories[entry.relativePath]);
    if (isExpanded) {
      setExpandedDirectories((current) => ({
        ...current,
        [entry.relativePath]: false,
      }));
      return;
    }

    setExpandedDirectories((current) => ({
      ...current,
      [entry.relativePath]: true,
    }));

    if (directoryEntries[entry.relativePath] || loadingDirectories[entry.relativePath]) {
      return;
    }

    setLoadingDirectories((current) => ({
      ...current,
      [entry.relativePath]: true,
    }));
    try {
      await loadDirectory(entry.relativePath);
    } catch (error) {
      setDirectoryErrors((current) => ({
        ...current,
        [entry.relativePath]: String(error),
      }));
    } finally {
      setLoadingDirectories((current) => ({
        ...current,
        [entry.relativePath]: false,
      }));
    }
  }, [directoryEntries, expandedDirectories, loadDirectory, loadingDirectories]);

  const rootEntries = directoryEntries[''] ?? [];
  const canRenderMarkdown = isRenderableMarkdown(preview);
  const canRenderHtml = isRenderableHtml(preview);
  const showRenderedPreview = previewMode === 'render' && (canRenderMarkdown || canRenderHtml);

  const previewMeta = useMemo(() => {
    if (!preview) return null;
    return `${formatBytes(preview.size)} · ${preview.containerPath}`;
  }, [preview]);

  const handleOpenFile = useCallback((relativePath: string) => {
    void loadPreview(relativePath);
  }, [loadPreview]);

  const handleToggleDirectory = useCallback((entry: AgentWorkspaceEntry) => {
    void toggleDirectory(entry);
  }, [toggleDirectory]);

  const renderTree = useCallback((entries: AgentWorkspaceEntry[], depth = 0) => {
    return entries.map((entry) => {
      const isDirectory = entry.kind === 'directory';
      const isExpanded = Boolean(expandedDirectories[entry.relativePath]);
      const isSelected = selectedFilePath === entry.relativePath;
      const childEntries = directoryEntries[entry.relativePath] ?? [];
      const childError = directoryErrors[entry.relativePath];
      const isLoadingChildren = Boolean(loadingDirectories[entry.relativePath]);

      return (
        <div
          key={entry.relativePath}
          className="min-w-0 [content-visibility:auto]"
          style={{ containIntrinsicSize: '44px auto' }}
        >
          <WorkspaceTreeNode
            entry={entry}
            depth={depth}
            isExpanded={isExpanded}
            isSelected={isSelected}
            folderLabel={t('workspace.folderLabel')}
            onToggleDirectory={handleToggleDirectory}
            onOpenFile={handleOpenFile}
          />

          {isDirectory && isExpanded && (
            <div className="min-w-0">
              {isLoadingChildren && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" style={{ paddingLeft: `${40 + depth * 16}px` }}>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t('workspace.loading')}</span>
                </div>
              )}

              {!isLoadingChildren && childError && (
                <div className="px-3 py-2 text-xs text-destructive" style={{ paddingLeft: `${40 + depth * 16}px` }}>
                  {childError}
                </div>
              )}

              {!isLoadingChildren && !childError && childEntries.length > 0 && renderTree(childEntries, depth + 1)}

              {!isLoadingChildren && !childError && childEntries.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground" style={{ paddingLeft: `${40 + depth * 16}px` }}>
                  {t('workspace.emptyFolder')}
                </div>
              )}
            </div>
          )}
        </div>
      );
    });
  }, [directoryEntries, directoryErrors, expandedDirectories, handleOpenFile, handleToggleDirectory, loadingDirectories, selectedFilePath, t]);

  const treeBody = useMemo(() => {
    if (loadingRoot && rootEntries.length === 0) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('workspace.loading')}
        </div>
      );
    }

    if (!loadingRoot && workspaceError) {
      return (
        <div className="m-2 rounded-[1.35rem] border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" />
            {t('workspace.loadFailed')}
          </div>
          <div className="break-words text-xs">{workspaceError}</div>
        </div>
      );
    }

    if (!loadingRoot && !workspaceError && workspace && !workspace.exists) {
      return (
        <div className="m-2 rounded-[1.35rem] border border-dashed border-black/10 bg-white/55 p-4 text-sm text-muted-foreground dark:border-white/10">
          <div className="font-medium text-foreground">{t('workspace.missingWorkspace')}</div>
          <div className="mt-1 break-words text-xs">{workspace.hostPath}</div>
        </div>
      );
    }

    if (!loadingRoot && !workspaceError && workspace?.exists && rootEntries.length === 0) {
      return (
        <div className="m-2 rounded-[1.35rem] border border-dashed border-black/10 bg-white/55 p-4 text-sm text-muted-foreground dark:border-white/10">
          {t('workspace.emptyWorkspace')}
        </div>
      );
    }

    if (!workspaceError && rootEntries.length > 0) {
      return renderTree(rootEntries);
    }

    return null;
  }, [loadingRoot, renderTree, rootEntries, t, workspace, workspaceError]);

  const previewBody = useMemo(() => {
    if (loadingPreview) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('workspace.loadingPreview')}
        </div>
      );
    }

    if (previewError) {
      return (
        <div className="rounded-[1.35rem] border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" />
            {t('workspace.previewFailed')}
          </div>
          <div className="break-words text-xs">{previewError}</div>
        </div>
      );
    }

    if (!preview) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="rounded-[1.75rem] border border-dashed border-black/10 bg-[#fffdf8] px-6 py-8 text-center dark:border-white/10">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">{t('workspace.previewEmptyTitle')}</div>
            <div className="mt-1 text-sm text-muted-foreground">{t('workspace.previewEmptyDescription')}</div>
          </div>
        </div>
      );
    }

    if (preview.kind === 'image') {
      return (
        <div className="flex min-h-full items-start justify-center">
          {preview.dataUrl ? (
            <img
              src={preview.dataUrl}
              alt={preview.name}
              className="max-h-full max-w-full rounded-[1.4rem] border border-black/10 bg-white object-contain shadow-sm dark:border-white/10 dark:bg-black/20"
            />
          ) : (
            <div className="rounded-[1.35rem] border border-dashed border-black/10 px-5 py-4 text-sm text-muted-foreground dark:border-white/10">
              {t('workspace.imageTooLarge')}
            </div>
          )}
        </div>
      );
    }

    if (preview.kind === 'binary') {
      return (
        <div className="rounded-[1.35rem] border border-dashed border-black/10 px-5 py-4 text-sm text-muted-foreground dark:border-white/10">
          {t('workspace.binaryUnsupported')}
        </div>
      );
    }

    if (preview.kind === 'text' && showRenderedPreview && canRenderHtml) {
      return (
        <div className="h-full min-h-[22rem] overflow-hidden rounded-[1.4rem] border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-black/20">
          <iframe
            title={preview.name}
            srcDoc={preview.content || ''}
            sandbox=""
            className="h-full w-full bg-white"
          />
        </div>
      );
    }

    if (preview.kind === 'text' && showRenderedPreview && canRenderMarkdown) {
      return (
        <div className="prose prose-sm max-w-none rounded-[1.4rem] border border-black/10 bg-white/75 p-5 shadow-sm dark:prose-invert dark:border-white/10 dark:bg-white/[0.03]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {preview.content || ''}
          </ReactMarkdown>
        </div>
      );
    }

    if (preview.kind === 'text') {
      return (
        <div className="overflow-hidden rounded-[1.4rem] border border-black/10 bg-black/[0.03] shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
          <pre className="overflow-auto p-4 text-sm leading-6 text-foreground">
            <code>{preview.content || ''}</code>
          </pre>
        </div>
      );
    }

    return null;
  }, [
    canRenderHtml,
    canRenderMarkdown,
    loadingPreview,
    preview,
    previewError,
    showRenderedPreview,
    t,
  ]);

  return (
    <aside
      data-testid="chat-workspace-panel"
      className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[2rem] border border-black/6 [contain:layout_paint_style] dark:border-white/10"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/6 px-4 py-3.5 dark:border-white/10">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-[-0.02em]">{t('workspace.title')}</div>
          <div className="truncate pt-0.5 text-xs text-muted-foreground">
            {workspace?.configuredPath || workspace?.hostPath || t('workspace.loading')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden max-w-[11rem] truncate rounded-full border border-black/8 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-foreground/70 dark:border-white/10 dark:text-foreground/80 md:block">
            {agentName}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full border border-black/8 bg-white/72 text-foreground/70 hover:bg-white"
            data-testid="workspace-refresh"
            onClick={() => void refreshWorkspace()}
            disabled={loadingRoot}
          >
            <RefreshCw className={cn('h-4 w-4', loadingRoot && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.92fr)_minmax(0,1.2fr)] gap-0">
        <div className="flex min-h-0 flex-col border-r border-black/6 bg-[#f7f2e8]/72 dark:border-white/10">
          <div className="shrink-0 border-b border-black/6 px-4 py-3 dark:border-white/10">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {t('workspace.treeTitle')}
            </div>
            <div className="truncate pt-1 text-xs text-muted-foreground">
              {workspace?.containerRoot || '/workspace'}
            </div>
          </div>

          <div data-testid="workspace-tree" className="min-h-0 flex-1 overflow-auto px-2.5 py-3 [contain:layout_paint_style]">
            {treeBody}
          </div>
        </div>

        <div className="flex min-h-0 flex-col bg-white/52">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/6 px-4 py-3 dark:border-white/10">
            <div className="min-w-0">
              <div
                data-testid="workspace-preview-title"
                className="truncate text-sm font-semibold tracking-[-0.02em]"
              >
                {preview?.name || t('workspace.previewTitle')}
              </div>
              <div className="truncate pt-0.5 text-xs text-muted-foreground">
                {previewMeta || t('workspace.previewHint')}
              </div>
            </div>

            {(canRenderMarkdown || canRenderHtml) && (
              <div className="flex items-center gap-1 rounded-full border border-black/8 bg-white/72 p-1 dark:border-white/10 dark:bg-white/5">
                <button
                  type="button"
                  onClick={() => setPreviewMode('render')}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                    previewMode === 'render'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t('workspace.previewRender')}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('source')}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                    previewMode === 'source'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t('workspace.previewSource')}
                </button>
              </div>
            )}
          </div>

          <div data-testid="workspace-preview" className="min-h-0 flex-1 overflow-auto p-4 [contain:layout_paint_style]">
            {previewBody}

            {!loadingPreview && preview?.truncated ? (
              <div className="mt-3 text-xs text-muted-foreground">
                {t('workspace.previewTruncated')}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}
