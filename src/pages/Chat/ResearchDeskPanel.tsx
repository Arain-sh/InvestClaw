import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import {
  AlertCircle,
  ChevronRight,
  ExternalLink,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import type { AgentSummary, AgentWorkspaceEntry, AgentWorkspaceFilePreview, AgentWorkspaceListing } from '@/types/agent';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';

const DEFAULT_BROWSER_URL = 'https://www.ainvest.com/';
const QUICK_BROWSER_LINKS = [
  { id: 'ainvest', url: 'https://www.ainvest.com/', label: 'AInvest' },
  { id: 'sec', url: 'https://www.sec.gov/', label: 'SEC' },
  { id: 'tradingview', url: 'https://www.tradingview.com/', label: 'TradingView' },
];

const ROOT_WORKSPACE_PATH = '';

type BrowserNavigationEvent = Event & { url?: string; title?: string };
type BrowserLoadFailureEvent = Event & {
  errorCode?: number;
  errorDescription?: string;
  validatedURL?: string;
  isMainFrame?: boolean;
};
type BrowserWebview = HTMLElement & {
  src: string;
  reload: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  getURL: () => string;
};

type WorkspaceListingMap = Record<string, AgentWorkspaceListing>;
type WorkspacePreviewMode = 'render' | 'source';

type BrowserTabState = {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: {
    code?: number;
    description: string;
    url: string;
  } | null;
};

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatTimestamp(timestamp: string | number | undefined): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function buildWorkspaceListingPath(agentId: string, relativePath?: string | null): string {
  const query = new URLSearchParams();
  if (relativePath) {
    query.set('path', relativePath);
  }
  const queryString = query.toString();
  return `/api/agents/${encodeURIComponent(agentId)}/workspace${queryString ? `?${queryString}` : ''}`;
}

function buildWorkspacePreviewPath(agentId: string, relativePath: string): string {
  const query = new URLSearchParams({ path: relativePath });
  return `/api/agents/${encodeURIComponent(agentId)}/workspace/file?${query.toString()}`;
}

function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_BROWSER_URL;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function getWorkspaceEntryIcon(entry: AgentWorkspaceEntry) {
  if (entry.kind === 'directory') {
    return <Folder className="h-4 w-4" />;
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(entry.extension)) {
    return <FileImage className="h-4 w-4" />;
  }
  if (['.md', '.txt'].includes(entry.extension)) {
    return <FileText className="h-4 w-4" />;
  }
  return <FileCode2 className="h-4 w-4" />;
}

function createBrowserTab(url: string, fallbackTitle: string): BrowserTabState {
  const nextId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `browser-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: nextId,
    url,
    title: fallbackTitle,
    loading: true,
    canGoBack: false,
    canGoForward: false,
    error: null,
  };
}

function getBrowserTitleFallback(url: string, fallbackTitle: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    return hostname || fallbackTitle;
  } catch {
    return fallbackTitle;
  }
}

function safeGetBrowserUrl(webview: BrowserWebview): string | null {
  try {
    return webview.getURL() || null;
  } catch {
    return null;
  }
}

function safeCanGoBack(webview: BrowserWebview): boolean {
  try {
    return webview.canGoBack();
  } catch {
    return false;
  }
}

function safeCanGoForward(webview: BrowserWebview): boolean {
  try {
    return webview.canGoForward();
  } catch {
    return false;
  }
}

function isHtmlWorkspacePreview(preview: AgentWorkspaceFilePreview): boolean {
  return preview.kind === 'text' && !preview.truncated && ['.html', '.htm'].includes(preview.extension);
}

function isComponentWorkspacePreview(preview: AgentWorkspaceFilePreview): boolean {
  return preview.kind === 'text' && !preview.truncated && ['.tsx', '.jsx'].includes(preview.extension);
}

function getRuntimeImportSpecifiers(compiledSource: string): string[] {
  const specifiers = new Set<string>();
  const pattern = /require\(["']([^"']+)["']\)/g;
  let match: RegExpExecArray | null = pattern.exec(compiledSource);
  while (match) {
    specifiers.add(match[1]);
    match = pattern.exec(compiledSource);
  }
  return [...specifiers];
}

class ComponentPreviewErrorBoundary extends React.Component<{
  children: React.ReactNode;
  onError: (error: Error) => void;
}, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

function HtmlPreviewSurface({
  preview,
}: {
  preview: AgentWorkspaceFilePreview;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden p-3">
      <div className="h-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-black/20">
        <iframe
          data-testid="chat-desk-html-preview"
          title={preview.name}
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          srcDoc={preview.content || ''}
          className="h-full w-full border-0 bg-white"
        />
      </div>
    </div>
  );
}

function ComponentPreviewSurface({
  preview,
}: {
  preview: AgentWorkspaceFilePreview;
}) {
  const { t } = useTranslation('chat');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [renderNode, setRenderNode] = useState<React.ReactNode>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const compilePreview = async () => {
      setStatus('loading');
      setRenderNode(null);
      setRenderError(null);

      try {
        const ts = await import('typescript');
        const source = preview.content || '';
        const transpiled = ts.transpileModule(source, {
          fileName: preview.name,
          reportDiagnostics: true,
          compilerOptions: {
            jsx: ts.JsxEmit.React,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
          },
        });

        const diagnostics = transpiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) || [];
        if (diagnostics.length > 0) {
          const message = ts.flattenDiagnosticMessageText(diagnostics[0].messageText, '\n');
          throw new Error(message);
        }

        const runtimeImports = getRuntimeImportSpecifiers(transpiled.outputText);
        const unsupportedImports = runtimeImports.filter((specifier) => ![
          'react',
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
        ].includes(specifier));

        if (unsupportedImports.length > 0) {
          throw new Error(t('desk.files.componentUnsupportedImports', {
            imports: unsupportedImports.join(', '),
          }));
        }

        const runtimeRequire = (specifier: string) => {
          if (specifier === 'react') return React;
          if (specifier === 'react/jsx-runtime' || specifier === 'react/jsx-dev-runtime') {
            return ReactJsxRuntime;
          }
          throw new Error(t('desk.files.componentUnsupportedImports', { imports: specifier }));
        };

        const exportsObject: Record<string, unknown> = {};
        const moduleObject = { exports: exportsObject };
        const evaluator = new Function(
          'exports',
          'module',
          'require',
          'React',
          `${transpiled.outputText}\n//# sourceURL=${preview.name}\nreturn module.exports ?? exports;`,
        ) as (
          exports: Record<string, unknown>,
          module: { exports: Record<string, unknown> },
          require: (specifier: string) => unknown,
          react: typeof React,
        ) => Record<string, unknown>;

        const evaluatedModule = evaluator(exportsObject, moduleObject, runtimeRequire, React);
        const exportedValue = evaluatedModule?.default ?? evaluatedModule;

        let nextNode: React.ReactNode = null;
        if (React.isValidElement(exportedValue)) {
          nextNode = exportedValue;
        } else if (typeof exportedValue === 'function') {
          nextNode = React.createElement(exportedValue as React.ComponentType);
        } else {
          throw new Error(t('desk.files.componentMissingDefault'));
        }

        if (cancelled) return;
        setRenderNode(nextNode);
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setRenderError(error instanceof Error ? error.message : String(error));
      }
    };

    void compilePreview();

    return () => {
      cancelled = true;
    };
  }, [preview.content, preview.name, t]);

  if (status === 'loading') {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-[20px] border border-black/10 bg-white/75 dark:border-white/10 dark:bg-black/10">
        <div className="flex items-center gap-3 text-[13px] text-foreground/65">
          <LoadingSpinner size="sm" />
          {t('desk.files.renderingPreview')}
        </div>
      </div>
    );
  }

  if (status === 'error' || !renderNode) {
    return (
      <div className="min-h-0 flex-1 p-3">
        <div className="rounded-2xl border border-dashed border-amber-300/70 bg-amber-50/80 p-4 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="font-medium">{t('desk.files.componentPreviewFailed')}</p>
          <p className="mt-2 break-words font-mono text-[12px] opacity-80">
            {renderError || t('desk.files.componentMissingDefault')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-black/20">
        <ComponentPreviewErrorBoundary
          key={preview.relativePath}
          onError={(error) => {
            setStatus('error');
            setRenderError(error.message);
          }}
        >
          <div data-testid="chat-desk-component-preview" className="min-h-[220px] px-5 py-5 text-foreground">
            {renderNode}
          </div>
        </ComponentPreviewErrorBoundary>
      </div>
    </div>
  );
}

function WorkspacePreviewPane({
  preview,
  loading,
  fallbackPath,
}: {
  preview: AgentWorkspaceFilePreview | null;
  loading: boolean;
  fallbackPath: string;
}) {
  const { t } = useTranslation('chat');
  const [previewMode, setPreviewMode] = useState<WorkspacePreviewMode>('source');

  const canRenderPreview = !!preview && (
    isHtmlWorkspacePreview(preview)
    || isComponentWorkspacePreview(preview)
  );

  useEffect(() => {
    setPreviewMode(canRenderPreview ? 'render' : 'source');
  }, [canRenderPreview, preview?.relativePath]);

  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-[20px] border border-black/10 bg-white/75 dark:border-white/10 dark:bg-black/10">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (!preview) {
    return (
      <div
        data-testid="chat-desk-preview"
        className="flex h-full min-h-0 flex-col rounded-[20px] border border-dashed border-black/10 bg-white/70 px-6 pt-10 text-center dark:border-white/10 dark:bg-black/10"
      >
        <div data-testid="chat-desk-preview-empty-state" className="flex flex-col items-center">
          <FileText className="mb-3 h-6 w-6 text-foreground/45" />
          <p className="text-[14px] font-medium text-foreground/80">{t('desk.files.selectFile')}</p>
          <p className="mt-1 font-mono text-[12px] text-foreground/55">
            {fallbackPath}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="chat-desk-preview" className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] border border-black/10 bg-white/75 dark:border-white/10 dark:bg-black/10">
      <div className="shrink-0 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-foreground">
            <FileText className="h-4 w-4 text-foreground/55" />
            <span className="truncate">{preview.name}</span>
          </div>
          {canRenderPreview && (
            <div className="flex shrink-0 items-center gap-1 rounded-full border border-black/10 bg-white/80 p-1 dark:border-white/10 dark:bg-black/10">
              <Button
                type="button"
                size="sm"
                variant={previewMode === 'render' ? 'secondary' : 'ghost'}
                data-testid="chat-desk-preview-mode-render"
                onClick={() => setPreviewMode('render')}
                className="h-7 rounded-full px-3 text-[11px]"
              >
                {t('desk.files.render')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={previewMode === 'source' ? 'secondary' : 'ghost'}
                data-testid="chat-desk-preview-mode-source"
                onClick={() => setPreviewMode('source')}
                className="h-7 rounded-full px-3 text-[11px]"
              >
                {t('desk.files.source')}
              </Button>
            </div>
          )}
        </div>
        <p className="mt-1 break-all font-mono text-[12px] text-foreground/70">{preview.containerPath}</p>
        <p className="break-all font-mono text-[11px] text-foreground/50">{preview.hostPath}</p>
        <p className="mt-1 text-[12px] text-foreground/55">
          {preview.mimeType} · {formatByteSize(preview.size)} · {formatTimestamp(preview.modifiedAt)}
        </p>
      </div>

      {previewMode === 'render' && isHtmlWorkspacePreview(preview) && (
        <HtmlPreviewSurface preview={preview} />
      )}

      {previewMode === 'render' && isComponentWorkspacePreview(preview) && (
        <ComponentPreviewSurface preview={preview} />
      )}

      {preview.kind === 'image' && preview.dataUrl && (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="overflow-hidden rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-black/20">
            <img src={preview.dataUrl} alt={preview.name} className="max-h-[520px] w-full rounded-xl object-contain" />
          </div>
        </div>
      )}

      {preview.kind === 'image' && !preview.dataUrl && (
        <div className="min-h-0 flex-1 p-3">
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
            {t('desk.files.imageTooLarge')}
          </div>
        </div>
      )}

      {previewMode === 'source' && preview.kind === 'text' && preview.extension === '.md' && (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="prose prose-sm max-w-none px-4 py-4 prose-headings:font-serif prose-pre:bg-black prose-pre:text-white dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content || ''}</ReactMarkdown>
          </div>
          {preview.truncated && (
            <div className="border-t border-black/10 px-4 py-2 text-[12px] text-foreground/60 dark:border-white/10">
              {t('desk.files.previewTruncated')}
            </div>
          )}
        </div>
      )}

      {previewMode === 'source' && preview.kind === 'text' && preview.extension !== '.md' && (
        <div className="min-h-0 flex-1 overflow-auto">
          <pre className="min-h-full px-4 py-4 font-mono text-[12px] leading-5 text-foreground">
            {preview.content}
          </pre>
          {preview.truncated && (
            <div className="border-t border-black/10 px-4 py-2 text-[12px] text-foreground/60 dark:border-white/10">
              {t('desk.files.previewTruncated')}
            </div>
          )}
        </div>
      )}

      {preview.kind === 'binary' && (
        <div className="min-h-0 flex-1 p-3">
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
            {t('desk.files.unsupportedPreview')}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkspaceTree({
  entries,
  depth,
  listings,
  expandedDirectories,
  loadingDirectories,
  selectedWorkspacePath,
  onToggleDirectory,
  onOpenFile,
}: {
  entries: AgentWorkspaceEntry[];
  depth: number;
  listings: WorkspaceListingMap;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  selectedWorkspacePath: string | null;
  onToggleDirectory: (entry: AgentWorkspaceEntry) => void;
  onOpenFile: (entry: AgentWorkspaceEntry) => void;
}) {
  const { t } = useTranslation('chat');

  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        const isDirectory = entry.kind === 'directory';
        const isExpanded = !!expandedDirectories[entry.relativePath];
        const childListing = listings[entry.relativePath];
        const isLoadingDirectory = !!loadingDirectories[entry.relativePath];

        return (
          <div key={entry.relativePath}>
            <button
              type="button"
              data-testid={isDirectory ? `chat-desk-folder-${entry.name}` : `chat-desk-file-${entry.name}`}
              onClick={() => (isDirectory ? onToggleDirectory(entry) : onOpenFile(entry))}
              className={cn(
                'flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10',
                selectedWorkspacePath === entry.relativePath && 'bg-black/10 dark:bg-white/10',
              )}
              style={{ paddingLeft: `${12 + depth * 18}px` }}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground/50">
                {isDirectory ? (
                  <ChevronRight className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')} />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-black/10 dark:bg-white/15" />
                )}
              </span>
              <span className="shrink-0 text-foreground/55">{getWorkspaceEntryIcon(entry)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">{entry.name}</p>
                <p className="truncate font-mono text-[11px] text-foreground/55">
                  {entry.containerPath} · {isDirectory ? t('desk.files.directory') : formatByteSize(entry.size)}
                </p>
              </div>
            </button>

            {isDirectory && isExpanded && (
              <div className="pt-1">
                {isLoadingDirectory && (
                  <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-foreground/55" style={{ paddingLeft: `${30 + depth * 18}px` }}>
                    <LoadingSpinner size="sm" />
                    {t('desk.files.loadingDirectory')}
                  </div>
                )}

                {!isLoadingDirectory && childListing && childListing.entries.length === 0 && (
                  <div className="px-3 py-2 text-[12px] text-foreground/55" style={{ paddingLeft: `${30 + depth * 18}px` }}>
                    {t('desk.files.empty')}
                  </div>
                )}

                {!isLoadingDirectory && childListing && childListing.entries.length > 0 && (
                  <WorkspaceTree
                    entries={childListing.entries}
                    depth={depth + 1}
                    listings={listings}
                    expandedDirectories={expandedDirectories}
                    loadingDirectories={loadingDirectories}
                    selectedWorkspacePath={selectedWorkspacePath}
                    onToggleDirectory={onToggleDirectory}
                    onOpenFile={onOpenFile}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BrowserWebviewPane({
  tab,
  active,
  fallbackTitle,
  onStateChange,
  onRegisterWebview,
}: {
  tab: BrowserTabState;
  active: boolean;
  fallbackTitle: string;
  onStateChange: (tabId: string, patch: Partial<BrowserTabState>) => void;
  onRegisterWebview: (tabId: string, webview: BrowserWebview | null) => void;
}) {
  const webviewRef = useRef<BrowserWebview | null>(null);

  useEffect(() => {
    onRegisterWebview(tab.id, webviewRef.current);
    return () => {
      onRegisterWebview(tab.id, null);
    };
  }, [onRegisterWebview, tab.id]);

  useEffect(() => {
    onStateChange(tab.id, { loading: true, error: null });
  }, [onStateChange, tab.id, tab.url]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const syncNavigationState = (eventUrl?: string) => {
      const nextUrl = eventUrl || safeGetBrowserUrl(webview) || tab.url;
      onStateChange(tab.id, {
        url: nextUrl,
        canGoBack: safeCanGoBack(webview),
        canGoForward: safeCanGoForward(webview),
      });
    };

    const handleDidStartLoading = () => {
      onStateChange(tab.id, { loading: true, error: null });
      syncNavigationState();
    };

    const handleDidStopLoading = () => {
      onStateChange(tab.id, { loading: false });
      syncNavigationState();
    };

    const handleNavigation = (event: BrowserNavigationEvent) => {
      syncNavigationState(event.url);
    };

    const handleTitleUpdate = (event: BrowserNavigationEvent) => {
      const nextUrl = event.url || safeGetBrowserUrl(webview) || tab.url;
      onStateChange(tab.id, {
        title: event.title || getBrowserTitleFallback(nextUrl, fallbackTitle),
      });
    };

    const handleDidFailLoad = (event: BrowserLoadFailureEvent) => {
      if (event.isMainFrame === false) {
        return;
      }

      const errorCode = typeof event.errorCode === 'number' ? event.errorCode : undefined;
      const failedUrl = event.validatedURL || tab.url;

      // ERR_ABORTED is commonly emitted during legitimate navigation changes
      // and redirects; it should not put the browser into a hard failure state.
      if (errorCode === -3) {
        onStateChange(tab.id, { loading: false });
        syncNavigationState(failedUrl);
        return;
      }

      const description = event.errorDescription || 'Failed to load this page';
      onStateChange(tab.id, {
        loading: false,
        url: failedUrl,
        title: getBrowserTitleFallback(failedUrl, fallbackTitle),
        canGoBack: safeCanGoBack(webview),
        canGoForward: safeCanGoForward(webview),
        error: {
          code: errorCode,
          description,
          url: failedUrl,
        },
      });
    };

    webview.addEventListener('did-start-loading', handleDidStartLoading as EventListener);
    webview.addEventListener('did-stop-loading', handleDidStopLoading as EventListener);
    webview.addEventListener('did-navigate', handleNavigation as EventListener);
    webview.addEventListener('did-navigate-in-page', handleNavigation as EventListener);
    webview.addEventListener('page-title-updated', handleTitleUpdate as EventListener);
    webview.addEventListener('did-fail-load', handleDidFailLoad as EventListener);

    return () => {
      webview.removeEventListener('did-start-loading', handleDidStartLoading as EventListener);
      webview.removeEventListener('did-stop-loading', handleDidStopLoading as EventListener);
      webview.removeEventListener('did-navigate', handleNavigation as EventListener);
      webview.removeEventListener('did-navigate-in-page', handleNavigation as EventListener);
      webview.removeEventListener('page-title-updated', handleTitleUpdate as EventListener);
      webview.removeEventListener('did-fail-load', handleDidFailLoad as EventListener);
    };
  }, [fallbackTitle, onStateChange, tab.id, tab.url]);

  return (
    <webview
      ref={(node) => {
        webviewRef.current = node as BrowserWebview | null;
      }}
      data-testid={active ? 'chat-desk-browser-webview' : undefined}
      src={tab.url}
      allowpopups={true}
      partition="persist:investclaw-browser"
      className={cn(
        'absolute inset-0 h-full w-full',
        active ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
    />
  );
}

export function ResearchDeskPanel({
  currentAgent,
}: {
  currentAgent: AgentSummary | null;
}) {
  const { t } = useTranslation('chat');
  const browserWebviewsRef = useRef<Record<string, BrowserWebview | null>>({});
  const [activeTab, setActiveTab] = useState('files');
  const [workspaceListings, setWorkspaceListings] = useState<WorkspaceListingMap>({});
  const [workspacePreview, setWorkspacePreview] = useState<AgentWorkspaceFilePreview | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspacePreviewLoading, setWorkspacePreviewLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({
    [ROOT_WORKSPACE_PATH]: true,
  });
  const [loadingDirectories, setLoadingDirectories] = useState<Record<string, boolean>>({});
  const [browserTabs, setBrowserTabs] = useState<BrowserTabState[]>([
    createBrowserTab(DEFAULT_BROWSER_URL, 'AInvest'),
  ]);
  const [activeBrowserTabId, setActiveBrowserTabId] = useState<string>('');
  const [browserInput, setBrowserInput] = useState(DEFAULT_BROWSER_URL);

  const rootListing = workspaceListings[ROOT_WORKSPACE_PATH] || null;
  const activeBrowserTab = browserTabs.find((tab) => tab.id === activeBrowserTabId) || browserTabs[0];

  const updateBrowserTab = useCallback((tabId: string, patch: Partial<BrowserTabState>) => {
    setBrowserTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  const registerBrowserWebview = useCallback((tabId: string, webview: BrowserWebview | null) => {
    browserWebviewsRef.current[tabId] = webview;
  }, []);

  const loadWorkspaceListing = useCallback(async (relativePath = ROOT_WORKSPACE_PATH) => {
    if (!currentAgent) {
      setWorkspaceListings({});
      setWorkspaceError(null);
      return;
    }

    const normalizedPath = relativePath || ROOT_WORKSPACE_PATH;
    if (normalizedPath === ROOT_WORKSPACE_PATH) {
      setWorkspaceLoading(true);
    }
    setLoadingDirectories((current) => ({ ...current, [normalizedPath]: true }));

    try {
      const response = await hostApiFetch<AgentWorkspaceListing>(buildWorkspaceListingPath(currentAgent.id, normalizedPath));
      setWorkspaceListings((current) => ({ ...current, [normalizedPath]: response }));
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(String(error));
      if (normalizedPath === ROOT_WORKSPACE_PATH) {
        setWorkspaceListings({});
      }
    } finally {
      if (normalizedPath === ROOT_WORKSPACE_PATH) {
        setWorkspaceLoading(false);
      }
      setLoadingDirectories((current) => {
        const next = { ...current };
        delete next[normalizedPath];
        return next;
      });
    }
  }, [currentAgent]);

  useEffect(() => {
    setWorkspaceListings({});
    setExpandedDirectories({ [ROOT_WORKSPACE_PATH]: true });
    setWorkspacePreview(null);
    setSelectedWorkspacePath(null);
    void loadWorkspaceListing(ROOT_WORKSPACE_PATH);
  }, [loadWorkspaceListing]);

  useEffect(() => {
    try {
      const savedUrl = window.localStorage.getItem('investclaw:desk-browser-url');
      if (!savedUrl) {
        setActiveBrowserTabId((current) => current || browserTabs[0]?.id || '');
        return;
      }

      setBrowserTabs([createBrowserTab(savedUrl, getBrowserTitleFallback(savedUrl, t('desk.browser.title')))]);
    } catch {
      setActiveBrowserTabId((current) => current || browserTabs[0]?.id || '');
    }
  }, [t]);

  useEffect(() => {
    if (!browserTabs.length) return;
    if (!activeBrowserTabId || !browserTabs.some((tab) => tab.id === activeBrowserTabId)) {
      setActiveBrowserTabId(browserTabs[0].id);
    }
  }, [activeBrowserTabId, browserTabs]);

  useEffect(() => {
    if (!activeBrowserTab) return;
    setBrowserInput(activeBrowserTab.url);

    try {
      window.localStorage.setItem('investclaw:desk-browser-url', activeBrowserTab.url);
    } catch {
      // ignore persistence issues
    }
  }, [activeBrowserTab]);

  const syncActiveBrowserNavigation = useCallback((tabId: string) => {
    const webview = browserWebviewsRef.current[tabId];
    const tab = browserTabs.find((candidate) => candidate.id === tabId);
    if (!webview || !tab) return;

    updateBrowserTab(tabId, {
      url: safeGetBrowserUrl(webview) || tab.url,
      canGoBack: safeCanGoBack(webview),
      canGoForward: safeCanGoForward(webview),
    });
  }, [browserTabs, updateBrowserTab]);

  useEffect(() => {
    if (!activeBrowserTab) return;
    syncActiveBrowserNavigation(activeBrowserTab.id);
  }, [activeBrowserTab, syncActiveBrowserNavigation]);

  const handleOpenWorkspaceFile = async (entry: AgentWorkspaceEntry) => {
    if (!currentAgent) return;
    if (entry.kind === 'symlink') {
      setWorkspaceError(t('desk.files.symlinkUnsupported'));
      return;
    }
    if (entry.kind !== 'file') {
      return;
    }

    setSelectedWorkspacePath(entry.relativePath);
    setWorkspacePreviewLoading(true);
    try {
      const response = await hostApiFetch<AgentWorkspaceFilePreview>(buildWorkspacePreviewPath(currentAgent.id, entry.relativePath));
      setWorkspacePreview(response);
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(String(error));
    } finally {
      setWorkspacePreviewLoading(false);
    }
  };

  const handleToggleWorkspaceDirectory = async (entry: AgentWorkspaceEntry) => {
    if (entry.kind === 'symlink') {
      setWorkspaceError(t('desk.files.symlinkUnsupported'));
      return;
    }
    if (entry.kind !== 'directory') {
      return;
    }

    const nextExpanded = !expandedDirectories[entry.relativePath];
    setExpandedDirectories((current) => ({ ...current, [entry.relativePath]: nextExpanded }));
    setSelectedWorkspacePath(entry.relativePath);

    if (nextExpanded && !workspaceListings[entry.relativePath]) {
      await loadWorkspaceListing(entry.relativePath);
    }
  };

  const handleRefreshWorkspace = async () => {
    setWorkspaceListings({});
    setExpandedDirectories({ [ROOT_WORKSPACE_PATH]: true });
    setWorkspacePreview(null);
    setSelectedWorkspacePath(null);
    await loadWorkspaceListing(ROOT_WORKSPACE_PATH);
  };

  const handleOpenWorkspaceFolder = async () => {
    const targetPath = rootListing?.hostPath || currentAgent?.workspace;
    if (!targetPath) return;
    const result = await invokeIpc<string>('shell:openPath', targetPath);
    if (result) {
      setWorkspaceError(result);
    }
  };

  const handleBrowserNavigate = () => {
    if (!activeBrowserTab) return;
    const nextUrl = normalizeBrowserUrl(browserInput);
    setBrowserInput(nextUrl);
    updateBrowserTab(activeBrowserTab.id, {
      url: nextUrl,
      title: getBrowserTitleFallback(nextUrl, t('desk.browser.title')),
      loading: true,
      error: null,
    });
  };

  const handleCreateBrowserTab = () => {
    const nextTab = createBrowserTab(DEFAULT_BROWSER_URL, 'AInvest');
    setBrowserTabs((current) => [...current, nextTab]);
    setActiveBrowserTabId(nextTab.id);
    setBrowserInput(nextTab.url);
  };

  const handleCloseBrowserTab = (tabId: string) => {
    setBrowserTabs((current) => {
      if (current.length === 1) {
        return current;
      }
      const closingIndex = current.findIndex((tab) => tab.id === tabId);
      const nextTabs = current.filter((tab) => tab.id !== tabId);
      const nextActive = nextTabs[Math.max(0, closingIndex - 1)] || nextTabs[0];
      if (tabId === activeBrowserTabId && nextActive) {
        setActiveBrowserTabId(nextActive.id);
      }
      delete browserWebviewsRef.current[tabId];
      return nextTabs;
    });
  };

  const workspaceFallbackPath = workspacePreview?.containerPath || rootListing?.currentContainerPath || '/workspace';
  const workspaceHostPath = rootListing?.hostPath || currentAgent?.workspace || '-';

  const activeBrowserState = useMemo(() => ({
    title: activeBrowserTab?.title || t('desk.browser.title'),
    loading: activeBrowserTab?.loading ?? false,
    canGoBack: activeBrowserTab?.canGoBack ?? false,
    canGoForward: activeBrowserTab?.canGoForward ?? false,
  }), [activeBrowserTab, t]);

  return (
    <Card data-testid="chat-research-desk" className="flex h-full min-h-[340px] flex-col rounded-[28px] border-0 bg-[#efe9db] shadow-[0_24px_80px_rgba(36,39,27,0.12)] dark:bg-card">
      <CardContent className="flex min-h-0 flex-1 flex-col p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-[12px] font-medium text-foreground/80 dark:border-white/10 dark:bg-white/5">
            <span className="truncate">{currentAgent?.name || 'Main Agent'}</span>
          </div>
          <div className="min-w-0 rounded-full border border-black/10 bg-white/50 px-3 py-1.5 font-mono text-[11px] text-foreground/60 dark:border-white/10 dark:bg-white/5">
            <span className="block truncate">{workspaceHostPath}</span>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full grid-cols-2 rounded-2xl bg-white/65 p-1 dark:bg-white/5">
            <TabsTrigger data-testid="chat-desk-tab-files" value="files">{t('desk.tabs.files')}</TabsTrigger>
            <TabsTrigger data-testid="chat-desk-tab-browser" value="browser">{t('desk.tabs.browser')}</TabsTrigger>
          </TabsList>

          <div className="relative mt-2 min-h-0 flex-1">
            <TabsContent
              forceMount
              value="files"
              className={cn(
                'absolute inset-0 m-0 flex min-h-0 flex-col data-[state=inactive]:pointer-events-none data-[state=inactive]:hidden',
                activeTab !== 'files' && 'hidden',
              )}
            >
              <div
                data-testid="chat-desk-files-surface"
                className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-black/10 bg-[#f9f6ec] dark:border-white/10 dark:bg-white/5"
              >
              <div className="shrink-0 border-b border-black/10 p-3 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void handleRefreshWorkspace()}
                    className="h-8 rounded-full border-black/10 bg-white/80 px-3 text-[12px] dark:border-white/10 dark:bg-white/5"
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    {t('desk.files.refresh')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleOpenWorkspaceFolder()}
                    disabled={!rootListing?.exists}
                    className="h-8 rounded-full border-black/10 bg-white/80 px-3 text-[12px] dark:border-white/10 dark:bg-white/5"
                  >
                    <FolderOpen className="mr-2 h-3.5 w-3.5" />
                    {t('desk.files.openFolder')}
                  </Button>
                </div>
                <div className="mt-3 rounded-2xl border border-black/10 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-black/10">
                  <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.08em] text-foreground/55">
                    <Folder className="h-3.5 w-3.5" />
                    {t('desk.files.containerPath')}
                  </div>
                  <p className="mt-1 break-all font-mono text-[12px] text-foreground">
                    {workspaceFallbackPath}
                  </p>
                </div>
                {workspaceError && (
                  <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[12px] text-destructive">
                    {workspaceError}
                  </div>
                )}
              </div>

              <div className="grid h-full min-h-0 flex-1 grid-rows-[minmax(0,1fr)] items-stretch content-stretch gap-px bg-black/10 dark:bg-white/10 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
                <div
                  data-testid="chat-desk-files"
                  className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f9f6ec] p-3 dark:bg-white/5"
                >
                  {!currentAgent ? (
                    <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
                      {t('desk.files.noAgent')}
                    </div>
                  ) : workspaceLoading ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center">
                      <LoadingSpinner size="md" />
                    </div>
                  ) : !rootListing?.exists ? (
                    <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
                      {t('desk.files.missing')}
                    </div>
                  ) : rootListing.entries.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
                      {t('desk.files.empty')}
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                      <div data-testid="chat-desk-tree-root" className="mb-2 flex items-center gap-2 rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-[12px] font-medium text-foreground/75 dark:border-white/10 dark:bg-black/10">
                        <FolderOpen className="h-4 w-4 text-foreground/55" />
                        <span className="truncate">/workspace</span>
                      </div>
                      <WorkspaceTree
                        entries={rootListing.entries}
                        depth={0}
                        listings={workspaceListings}
                        expandedDirectories={expandedDirectories}
                        loadingDirectories={loadingDirectories}
                        selectedWorkspacePath={selectedWorkspacePath}
                        onToggleDirectory={handleToggleWorkspaceDirectory}
                        onOpenFile={handleOpenWorkspaceFile}
                      />
                    </div>
                  )}
                </div>

                <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f9f6ec] p-3 dark:bg-white/5">
                  <WorkspacePreviewPane
                    preview={workspacePreview}
                    loading={workspacePreviewLoading}
                    fallbackPath={workspaceFallbackPath}
                  />
                </div>
              </div>
              </div>
            </TabsContent>

            <TabsContent
              forceMount
              value="browser"
              className="absolute inset-0 m-0 flex min-h-0 flex-col data-[state=inactive]:pointer-events-none data-[state=inactive]:hidden"
            >
              <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-black/10 bg-[#f9f6ec] dark:border-white/10 dark:bg-white/5">
              <div data-testid="chat-desk-browser-tabs" className="shrink-0 border-b border-black/10 dark:border-white/10">
                <div className="flex items-center gap-2 overflow-x-auto px-3 py-2">
                  {browserTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      data-testid="chat-desk-browser-tab"
                      onClick={() => setActiveBrowserTabId(tab.id)}
                      className={cn(
                        'group flex min-w-0 max-w-[220px] items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                        tab.id === activeBrowserTabId
                          ? 'border-black/15 bg-white text-foreground shadow-sm dark:border-white/15 dark:bg-black/10'
                          : 'border-transparent bg-transparent text-foreground/65 hover:border-black/10 hover:bg-white/60 dark:hover:border-white/10 dark:hover:bg-black/10',
                      )}
                    >
                      {tab.loading ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
                      )}
                      <span className="truncate text-[12px] font-medium">
                        {tab.title || getBrowserTitleFallback(tab.url, t('desk.browser.title'))}
                      </span>
                      {browserTabs.length > 1 && (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={t('desk.browser.closeTab')}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCloseBrowserTab(tab.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              handleCloseBrowserTab(tab.id);
                            }
                          }}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                        >
                          <X className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </button>
                  ))}

                  <button
                    type="button"
                    data-testid="chat-desk-browser-new-tab"
                    onClick={handleCreateBrowserTab}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-white/70 text-foreground/65 transition-colors hover:bg-white dark:border-white/10 dark:bg-black/10 dark:hover:bg-black/20"
                    aria-label={t('desk.browser.newTab')}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="shrink-0 border-b border-black/10 px-3 py-2 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => browserWebviewsRef.current[activeBrowserTab?.id || '']?.goBack()}
                    disabled={!activeBrowserState.canGoBack}
                    className="h-8 rounded-full border-black/10 bg-white/80 px-3 text-[12px] dark:border-white/10 dark:bg-white/5"
                  >
                    {t('desk.browser.back')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => browserWebviewsRef.current[activeBrowserTab?.id || '']?.goForward()}
                    disabled={!activeBrowserState.canGoForward}
                    className="h-8 rounded-full border-black/10 bg-white/80 px-3 text-[12px] dark:border-white/10 dark:bg-white/5"
                  >
                    {t('desk.browser.forward')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => browserWebviewsRef.current[activeBrowserTab?.id || '']?.reload()}
                    className="h-8 rounded-full border-black/10 bg-white/80 px-3 text-[12px] dark:border-white/10 dark:bg-white/5"
                  >
                    <RefreshCw className={cn('mr-2 h-3.5 w-3.5', activeBrowserState.loading && 'animate-spin')} />
                    {t('desk.browser.reload')}
                  </Button>

                  <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-2xl border border-black/10 bg-white/80 p-2 dark:border-white/10 dark:bg-black/10">
                    <Globe className="ml-1 h-4 w-4 shrink-0 text-foreground/55" />
                    <Input
                      data-testid="chat-desk-browser-url"
                      value={browserInput}
                      onChange={(event) => setBrowserInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          handleBrowserNavigate();
                        }
                      }}
                      className="h-9 border-0 bg-transparent text-[13px] shadow-none focus-visible:ring-0"
                    />
                    <Button onClick={handleBrowserNavigate} className="h-9 rounded-full px-4 text-[12px]">
                      <Search className="mr-2 h-3.5 w-3.5" />
                      {t('desk.browser.go')}
                    </Button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {QUICK_BROWSER_LINKS.map((link) => (
                    <button
                      key={link.id}
                      type="button"
                      data-testid={`chat-desk-browser-link-${link.id}`}
                      onClick={() => {
                        if (!activeBrowserTab) return;
                        setBrowserInput(link.url);
                        updateBrowserTab(activeBrowserTab.id, {
                          url: link.url,
                          title: getBrowserTitleFallback(link.url, link.label),
                          loading: true,
                          error: null,
                        });
                      }}
                      className="rounded-full border border-black/10 bg-white/80 px-3 py-1.5 text-[12px] font-medium text-foreground/75 transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              </div>

              <div data-testid="chat-desk-browser-surface" className="relative min-h-0 flex-1 overflow-hidden bg-white/80 dark:bg-black/10">
                {/* Electron webviews can keep intercepting pointer events even when
                    visually hidden, so only mount the currently visible browser tab. */}
                {activeTab === 'browser' && activeBrowserTab && (
                  <BrowserWebviewPane
                    key={activeBrowserTab.id}
                    tab={activeBrowserTab}
                    active
                    fallbackTitle={t('desk.browser.title')}
                    onStateChange={updateBrowserTab}
                    onRegisterWebview={registerBrowserWebview}
                  />
                )}
                {activeBrowserTab?.error && (
                  <div
                    data-testid="chat-desk-browser-error"
                    className="absolute inset-0 z-10 flex items-center justify-center bg-[#f9f6ec]/96 p-5 dark:bg-black/90"
                  >
                    <div className="w-full max-w-md rounded-[24px] border border-black/10 bg-white/90 p-5 shadow-xl dark:border-white/10 dark:bg-card">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-full bg-destructive/10 p-2 text-destructive">
                          <AlertCircle className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold text-foreground">
                            {t('desk.browser.loadFailedTitle')}
                          </p>
                          <p className="mt-1 text-[13px] leading-6 text-foreground/70">
                            {t('desk.browser.loadFailedBody')}
                          </p>
                          <p className="mt-3 break-all rounded-2xl border border-black/10 bg-black/[0.03] px-3 py-2 font-mono text-[12px] text-foreground/70 dark:border-white/10 dark:bg-white/[0.04]">
                            {activeBrowserTab.error.url}
                          </p>
                          <p className="mt-2 text-[12px] text-foreground/55">
                            {activeBrowserTab.error.description}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button
                          className="h-9 rounded-full px-4 text-[12px]"
                          onClick={() => {
                            if (!activeBrowserTab) return;
                            updateBrowserTab(activeBrowserTab.id, { loading: true, error: null });
                            const webview = browserWebviewsRef.current[activeBrowserTab.id];
                            if (webview) {
                              webview.reload();
                            }
                          }}
                        >
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          {t('desk.browser.retry')}
                        </Button>
                        <Button
                          variant="outline"
                          className="h-9 rounded-full px-4 text-[12px]"
                          onClick={() => {
                            const targetUrl = activeBrowserTab.error?.url || activeBrowserTab.url;
                            window.electron?.openExternal?.(targetUrl);
                          }}
                        >
                          <ExternalLink className="mr-2 h-3.5 w-3.5" />
                          {t('desk.browser.openExternal')}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
}
