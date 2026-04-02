import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronRight,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  HardDrive,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import type { AgentSummary, AgentWorkspaceEntry, AgentWorkspaceFilePreview, AgentWorkspaceListing } from '@/types/agent';
import type { GatewayStatus } from '@/types/gateway';
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

type BrowserNavigationEvent = Event & { url?: string; title?: string };
type BrowserWebview = HTMLElement & {
  src: string;
  reload: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  getURL: () => string;
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

function buildWorkspaceBrowserPath(agentId: string, relativePath?: string | null): string {
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

function WorkspacePreviewPane({
  preview,
  loading,
  listing,
}: {
  preview: AgentWorkspaceFilePreview | null;
  loading: boolean;
  listing: AgentWorkspaceListing | null;
}) {
  const { t } = useTranslation('chat');

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center rounded-3xl border border-black/10 bg-[#f9f6ec] dark:border-white/10 dark:bg-white/5">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (!preview) {
    return (
      <div
        data-testid="chat-desk-preview"
        className="flex min-h-[280px] flex-col items-center justify-center rounded-3xl border border-dashed border-black/10 bg-[#f9f6ec] px-6 text-center dark:border-white/10 dark:bg-white/5"
      >
        <FileText className="mb-3 h-6 w-6 text-foreground/45" />
        <p className="text-[14px] font-medium text-foreground/80">{t('desk.files.selectFile')}</p>
        <p className="mt-1 font-mono text-[12px] text-foreground/55">
          {listing?.currentContainerPath || '/workspace'}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="chat-desk-preview" className="rounded-3xl border border-black/10 bg-[#f9f6ec] p-4 dark:border-white/10 dark:bg-white/5">
      <div className="mb-4 space-y-1">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
          <FileText className="h-4 w-4 text-foreground/55" />
          <span>{preview.name}</span>
        </div>
        <p className="font-mono text-[12px] text-foreground/70 break-all">{preview.containerPath}</p>
        <p className="font-mono text-[12px] text-foreground/55 break-all">{preview.hostPath}</p>
        <p className="text-[12px] text-foreground/55">
          {preview.mimeType} · {formatByteSize(preview.size)} · {formatTimestamp(preview.modifiedAt)}
        </p>
      </div>

      {preview.kind === 'image' && preview.dataUrl && (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-black/10">
          <img src={preview.dataUrl} alt={preview.name} className="max-h-[360px] w-full rounded-xl object-contain" />
        </div>
      )}

      {preview.kind === 'image' && !preview.dataUrl && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
          {t('desk.files.imageTooLarge')}
        </div>
      )}

      {preview.kind === 'text' && preview.extension === '.md' && (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white/80 dark:border-white/10 dark:bg-black/10">
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

      {preview.kind === 'text' && preview.extension !== '.md' && (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-white/80 dark:border-white/10 dark:bg-black/10">
          <pre className="max-h-[360px] overflow-auto px-4 py-4 font-mono text-[12px] leading-5 text-foreground">
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
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
          {t('desk.files.unsupportedPreview')}
        </div>
      )}
    </div>
  );
}

export function ResearchDeskPanel({
  currentAgent,
  currentSessionKey,
  gatewayStatus,
  messageCount,
  sending,
  showThinking,
}: {
  currentAgent: AgentSummary | null;
  currentSessionKey: string;
  gatewayStatus: GatewayStatus;
  messageCount: number;
  sending: boolean;
  showThinking: boolean;
}) {
  const { t } = useTranslation('chat');
  const webviewRef = useRef<BrowserWebview | null>(null);
  const [activeTab, setActiveTab] = useState('files');
  const [workspaceListing, setWorkspaceListing] = useState<AgentWorkspaceListing | null>(null);
  const [workspacePreview, setWorkspacePreview] = useState<AgentWorkspaceFilePreview | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspacePreviewLoading, setWorkspacePreviewLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
  const [browserInput, setBrowserInput] = useState(DEFAULT_BROWSER_URL);
  const [browserUrl, setBrowserUrl] = useState(DEFAULT_BROWSER_URL);
  const [browserTitle, setBrowserTitle] = useState('AInvest');
  const [browserLoading, setBrowserLoading] = useState(true);
  const [browserCanGoBack, setBrowserCanGoBack] = useState(false);
  const [browserCanGoForward, setBrowserCanGoForward] = useState(false);

  const loadWorkspaceListing = useCallback(async (relativePath = '') => {
    if (!currentAgent) {
      setWorkspaceListing(null);
      return;
    }
    setWorkspaceLoading(true);
    try {
      const response = await hostApiFetch<AgentWorkspaceListing>(buildWorkspaceBrowserPath(currentAgent.id, relativePath));
      setWorkspaceListing(response);
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(String(error));
      setWorkspaceListing(null);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [currentAgent]);

  useEffect(() => {
    setWorkspacePreview(null);
    setSelectedWorkspacePath(null);
    void loadWorkspaceListing('');
  }, [loadWorkspaceListing]);

  useEffect(() => {
    try {
      const savedUrl = window.localStorage.getItem('investclaw:desk-browser-url');
      if (savedUrl) {
        setBrowserInput(savedUrl);
        setBrowserUrl(savedUrl);
      }
    } catch {
      // ignore persistence issues
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('investclaw:desk-browser-url', browserUrl);
    } catch {
      // ignore persistence issues
    }
  }, [browserUrl]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const syncNavigationState = () => {
      setBrowserCanGoBack(webview.canGoBack());
      setBrowserCanGoForward(webview.canGoForward());
      const nextUrl = webview.getURL();
      if (nextUrl) {
        setBrowserInput(nextUrl);
      }
    };

    const handleDidStartLoading = () => {
      setBrowserLoading(true);
    };

    const handleDidStopLoading = () => {
      setBrowserLoading(false);
      syncNavigationState();
    };

    const handleNavigation = (event: BrowserNavigationEvent) => {
      if (event.url) {
        setBrowserInput(event.url);
      }
      syncNavigationState();
    };

    const handleTitleUpdate = (event: BrowserNavigationEvent) => {
      setBrowserTitle(event.title || t('desk.browser.title'));
    };

    webview.addEventListener('did-start-loading', handleDidStartLoading as EventListener);
    webview.addEventListener('did-stop-loading', handleDidStopLoading as EventListener);
    webview.addEventListener('did-navigate', handleNavigation as EventListener);
    webview.addEventListener('did-navigate-in-page', handleNavigation as EventListener);
    webview.addEventListener('page-title-updated', handleTitleUpdate as EventListener);

    return () => {
      webview.removeEventListener('did-start-loading', handleDidStartLoading as EventListener);
      webview.removeEventListener('did-stop-loading', handleDidStopLoading as EventListener);
      webview.removeEventListener('did-navigate', handleNavigation as EventListener);
      webview.removeEventListener('did-navigate-in-page', handleNavigation as EventListener);
      webview.removeEventListener('page-title-updated', handleTitleUpdate as EventListener);
    };
  }, [activeTab, browserUrl, t]);

  const handleOpenWorkspaceEntry = async (entry: AgentWorkspaceEntry) => {
    if (!currentAgent) return;
    if (entry.kind === 'symlink') {
      setWorkspaceError(t('desk.files.symlinkUnsupported'));
      return;
    }
    if (entry.kind === 'directory') {
      setWorkspacePreview(null);
      setSelectedWorkspacePath(null);
      await loadWorkspaceListing(entry.relativePath);
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

  const handleOpenWorkspaceFolder = async () => {
    const targetPath = workspaceListing?.hostPath || currentAgent?.workspace;
    if (!targetPath) return;
    const result = await invokeIpc<string>('shell:openPath', targetPath);
    if (result) {
      setWorkspaceError(result);
    }
  };

  const handleBrowserNavigate = () => {
    const nextUrl = normalizeBrowserUrl(browserInput);
    setBrowserInput(nextUrl);
    setBrowserUrl(nextUrl);
    setBrowserLoading(true);
  };

  const runtimeItems = useMemo(() => ([
    {
      label: t('desk.runtime.currentAgent'),
      value: currentAgent?.name || 'main',
      detail: currentAgent?.id || 'main',
      icon: <Bot className="h-4 w-4" />,
    },
    {
      label: t('desk.runtime.gateway'),
      value: gatewayStatus.state,
      detail: `port ${gatewayStatus.port}${gatewayStatus.pid ? ` · pid ${gatewayStatus.pid}` : ''}`,
      icon: <ShieldCheck className="h-4 w-4" />,
    },
    {
      label: t('desk.runtime.session'),
      value: currentSessionKey,
      detail: `${messageCount} ${t('desk.runtime.messages')}`,
      icon: <FileText className="h-4 w-4" />,
    },
    {
      label: t('desk.runtime.workspace'),
      value: workspaceListing?.hostPath || currentAgent?.workspace || '-',
      detail: workspaceListing?.currentContainerPath || '/workspace',
      icon: <HardDrive className="h-4 w-4" />,
    },
  ]), [currentAgent, currentSessionKey, gatewayStatus.pid, gatewayStatus.port, gatewayStatus.state, messageCount, t, workspaceListing]);

  return (
    <Card data-testid="chat-research-desk" className="flex h-full min-h-[340px] flex-col rounded-[28px] border-0 bg-[#efe9db] shadow-[0_24px_80px_rgba(36,39,27,0.12)] dark:bg-card">
      <CardContent className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-foreground/50">{t('desk.kicker')}</p>
            <h2 className="text-[22px] font-serif tracking-tight text-foreground">{t('desk.title')}</h2>
            <p className="mt-1 text-[13px] text-foreground/70">{t('desk.subtitle')}</p>
          </div>
          <div className="rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-[12px] font-medium text-foreground/75 dark:border-white/10 dark:bg-white/5">
            {currentAgent?.name || 'Main Agent'}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full grid-cols-3 rounded-2xl bg-white/65 p-1 dark:bg-white/5">
            <TabsTrigger data-testid="chat-desk-tab-files" value="files">{t('desk.tabs.files')}</TabsTrigger>
            <TabsTrigger data-testid="chat-desk-tab-runtime" value="runtime">{t('desk.tabs.runtime')}</TabsTrigger>
            <TabsTrigger data-testid="chat-desk-tab-browser" value="browser">{t('desk.tabs.browser')}</TabsTrigger>
          </TabsList>

          <TabsContent value="files" className="mt-4 flex min-h-0 flex-1 flex-col">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void loadWorkspaceListing(workspaceListing?.currentRelativePath || '')}
                className="h-8 rounded-full border-black/10 bg-white/80 px-3 text-[12px] dark:border-white/10 dark:bg-white/5"
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                {t('desk.files.refresh')}
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleOpenWorkspaceFolder()}
                disabled={!workspaceListing?.exists}
                className="h-8 rounded-full border-black/10 bg-white/80 px-3 text-[12px] dark:border-white/10 dark:bg-white/5"
              >
                <FolderOpen className="mr-2 h-3.5 w-3.5" />
                {t('desk.files.openFolder')}
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
              <div data-testid="chat-desk-files" className="min-h-0 rounded-3xl border border-black/10 bg-[#f9f6ec] p-3 dark:border-white/10 dark:bg-white/5">
                <div className="mb-3 rounded-2xl border border-black/10 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-black/10">
                  <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.08em] text-foreground/55">
                    <HardDrive className="h-3.5 w-3.5" />
                    {t('desk.files.containerPath')}
                  </div>
                  <p className="mt-1 font-mono text-[12px] text-foreground break-all">
                    {workspaceListing?.currentContainerPath || '/workspace'}
                  </p>
                </div>

                {workspaceError && (
                  <div className="mb-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[12px] text-destructive">
                    {workspaceError}
                  </div>
                )}

                {workspaceLoading ? (
                  <div className="flex min-h-[280px] items-center justify-center">
                    <LoadingSpinner size="md" />
                  </div>
                ) : !workspaceListing?.exists ? (
                  <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
                    {t('desk.files.missing')}
                  </div>
                ) : (
                  <div className="min-h-0 space-y-1 overflow-auto">
                    {workspaceListing.parentRelativePath !== null && (
                      <button
                        type="button"
                        onClick={() => void loadWorkspaceListing(workspaceListing.parentRelativePath || '')}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <FolderOpen className="h-4 w-4 text-foreground/55" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground">{t('desk.files.parentDirectory')}</p>
                          <p className="font-mono text-[11px] text-foreground/55">
                            {workspaceListing.parentRelativePath || '/workspace'}
                          </p>
                        </div>
                      </button>
                    )}

                    {workspaceListing.entries.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
                        {t('desk.files.empty')}
                      </div>
                    ) : (
                      workspaceListing.entries.map((entry) => (
                        <button
                          key={entry.relativePath}
                          type="button"
                          data-testid={entry.kind === 'file' ? `chat-desk-file-${entry.name}` : undefined}
                          onClick={() => void handleOpenWorkspaceEntry(entry)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10',
                            selectedWorkspacePath === entry.relativePath && 'bg-black/10 dark:bg-white/10',
                          )}
                        >
                          <span className="text-foreground/55">{getWorkspaceEntryIcon(entry)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-foreground">{entry.name}</p>
                            <p className="font-mono text-[11px] text-foreground/55">
                              {entry.containerPath} · {entry.kind === 'directory' ? t('desk.files.directory') : formatByteSize(entry.size)}
                            </p>
                          </div>
                          {entry.kind === 'directory' && <ChevronRight className="h-4 w-4 text-foreground/45" />}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <WorkspacePreviewPane
                preview={workspacePreview}
                loading={workspacePreviewLoading}
                listing={workspaceListing}
              />
            </div>
          </TabsContent>

          <TabsContent value="runtime" className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              {runtimeItems.map((item) => (
                <div key={item.label} className="rounded-3xl border border-black/10 bg-[#f9f6ec] p-4 dark:border-white/10 dark:bg-white/5">
                  <div className="mb-2 flex items-center gap-2 text-[12px] uppercase tracking-[0.08em] text-foreground/55">
                    {item.icon}
                    {item.label}
                  </div>
                  <p className="font-mono text-[13px] text-foreground break-all">{item.value}</p>
                  <p className="mt-1 text-[12px] text-foreground/60 break-all">{item.detail}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-3xl border border-black/10 bg-[#f9f6ec] p-4 dark:border-white/10 dark:bg-white/5">
                <p className="text-[11px] uppercase tracking-[0.08em] text-foreground/55">{t('desk.runtime.sending')}</p>
                <p className="mt-2 text-[16px] font-semibold text-foreground">{sending ? t('desk.runtime.yes') : t('desk.runtime.no')}</p>
              </div>
              <div className="rounded-3xl border border-black/10 bg-[#f9f6ec] p-4 dark:border-white/10 dark:bg-white/5">
                <p className="text-[11px] uppercase tracking-[0.08em] text-foreground/55">{t('desk.runtime.thinking')}</p>
                <p className="mt-2 text-[16px] font-semibold text-foreground">{showThinking ? t('desk.runtime.visible') : t('desk.runtime.hidden')}</p>
              </div>
              <div className="rounded-3xl border border-black/10 bg-[#f9f6ec] p-4 dark:border-white/10 dark:bg-white/5">
                <p className="text-[11px] uppercase tracking-[0.08em] text-foreground/55">{t('desk.runtime.lastUpdated')}</p>
                <p className="mt-2 text-[16px] font-semibold text-foreground">{formatTimestamp(Date.now())}</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="browser" className="mt-4 flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => webviewRef.current?.goBack()}
                disabled={!browserCanGoBack}
                className="h-8 rounded-full border-black/10 bg-white/80 px-3 text-[12px] dark:border-white/10 dark:bg-white/5"
              >
                {t('desk.browser.back')}
              </Button>
              <Button
                variant="outline"
                onClick={() => webviewRef.current?.goForward()}
                disabled={!browserCanGoForward}
                className="h-8 rounded-full border-black/10 bg-white/80 px-3 text-[12px] dark:border-white/10 dark:bg-white/5"
              >
                {t('desk.browser.forward')}
              </Button>
              <Button
                variant="outline"
                onClick={() => webviewRef.current?.reload()}
                className="h-8 rounded-full border-black/10 bg-white/80 px-3 text-[12px] dark:border-white/10 dark:bg-white/5"
              >
                <RefreshCw className={cn('mr-2 h-3.5 w-3.5', browserLoading && 'animate-spin')} />
                {t('desk.browser.reload')}
              </Button>
              {QUICK_BROWSER_LINKS.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => {
                    setBrowserInput(link.url);
                    setBrowserUrl(link.url);
                  }}
                  className="rounded-full border border-black/10 bg-white/80 px-3 py-1.5 text-[12px] font-medium text-foreground/75 transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  {link.label}
                </button>
              ))}
            </div>

            <div className="mb-3 flex items-center gap-2 rounded-3xl border border-black/10 bg-[#f9f6ec] p-3 dark:border-white/10 dark:bg-white/5">
              <Globe className="h-4 w-4 text-foreground/55" />
              <Input
                data-testid="chat-desk-browser-url"
                value={browserInput}
                onChange={(event) => setBrowserInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleBrowserNavigate();
                  }
                }}
                className="h-9 border-0 bg-white/80 text-[13px] dark:bg-black/10"
              />
              <Button onClick={handleBrowserNavigate} className="h-9 rounded-full px-4 text-[12px]">
                <Search className="mr-2 h-3.5 w-3.5" />
                {t('desk.browser.go')}
              </Button>
            </div>

            <div className="mb-2 flex items-center justify-between px-1">
              <div>
                <p className="text-[13px] font-medium text-foreground">{browserTitle || t('desk.browser.title')}</p>
                <p className="font-mono text-[11px] text-foreground/55">{browserUrl}</p>
              </div>
              {browserLoading && (
                <div className="flex items-center gap-2 text-[12px] text-foreground/55">
                  <LoadingSpinner size="sm" />
                  {t('desk.browser.loading')}
                </div>
              )}
            </div>

            <div data-testid="chat-desk-browser-surface" className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-black/10 bg-white/80 dark:border-white/10 dark:bg-black/10">
              <webview
                ref={(node) => {
                  webviewRef.current = node as BrowserWebview | null;
                }}
                data-testid="chat-desk-browser-webview"
                src={browserUrl}
                allowpopups={true}
                partition="persist:investclaw-browser"
                className="h-full w-full"
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
