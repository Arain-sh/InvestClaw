import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import {
  AlertCircle,
  BarChart3,
  Building2,
  ChevronRight,
  Download,
  ExternalLink,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Monitor,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  TrendingUp,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import type { AgentSummary, AgentWorkspaceEntry, AgentWorkspaceFilePreview, AgentWorkspaceListing } from '@/types/agent';
import type { MarketAppDescriptor, MarketAppsSnapshot } from '@/types/market-app';
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
type DeskView = 'files' | 'apps' | 'browser';

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

const ADAPTIVE_RENDER_CSS = `
  html, body {
    margin: 0;
    min-height: 100%;
    background: #ffffff;
    color: #111827;
    overflow: auto;
  }

  body {
    box-sizing: border-box;
    padding: clamp(12px, 2vw, 20px);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  img, video, canvas, svg, iframe, embed, object {
    max-width: 100% !important;
    height: auto !important;
  }

  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  table {
    display: block;
    max-width: 100%;
    overflow-x: auto;
  }

  #investclaw-preview-root {
    width: 100%;
    transform-origin: top left;
  }

  #investclaw-preview-root > *,
  #investclaw-preview-root main,
  #investclaw-preview-root section,
  #investclaw-preview-root article,
  #investclaw-preview-root div,
  #investclaw-preview-root [style*="width"] {
    max-width: 100% !important;
  }
`;

const ADAPTIVE_COMPONENT_PREVIEW_CSS = `
  [data-investclaw-component-preview-root] {
    width: 100%;
    color: inherit;
  }

  [data-investclaw-component-preview-root] > *,
  [data-investclaw-component-preview-root] main,
  [data-investclaw-component-preview-root] section,
  [data-investclaw-component-preview-root] article,
  [data-investclaw-component-preview-root] div,
  [data-investclaw-component-preview-root] [style*="width"] {
    max-width: 100% !important;
  }

  [data-investclaw-component-preview-root],
  [data-investclaw-component-preview-root] *,
  [data-investclaw-component-preview-root] *::before,
  [data-investclaw-component-preview-root] *::after {
    box-sizing: border-box;
  }

  [data-investclaw-component-preview-root] img,
  [data-investclaw-component-preview-root] video,
  [data-investclaw-component-preview-root] canvas,
  [data-investclaw-component-preview-root] svg,
  [data-investclaw-component-preview-root] iframe,
  [data-investclaw-component-preview-root] embed,
  [data-investclaw-component-preview-root] object {
    max-width: 100% !important;
    height: auto !important;
  }

  [data-investclaw-component-preview-root] pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  [data-investclaw-component-preview-root] table {
    display: block;
    max-width: 100%;
    overflow-x: auto;
  }
`;

const ADAPTIVE_RENDER_SCRIPT = `
  (() => {
    const ROOT_ID = 'investclaw-preview-root';
    let resizeFrame = 0;

    function ensureRoot() {
      const body = document.body || document.documentElement;
      let root = document.getElementById(ROOT_ID);
      if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        while (body.firstChild) {
          root.appendChild(body.firstChild);
        }
        body.appendChild(root);
      }
      return root;
    }

    function fit() {
      const body = document.body || document.documentElement;
      const root = ensureRoot();
      const viewportWidth = Math.max(window.innerWidth - 32, 1);

      root.style.transform = 'scale(1)';
      root.style.width = '100%';

      const naturalWidth = Math.max(
        root.scrollWidth,
        root.getBoundingClientRect().width,
        body.scrollWidth,
        document.documentElement.scrollWidth,
        viewportWidth,
      );
      const scale = naturalWidth > viewportWidth ? viewportWidth / naturalWidth : 1;

      root.style.transform = 'scale(' + scale + ')';
      root.style.width = scale < 1 ? (100 / scale) + '%' : '100%';

      const naturalHeight = Math.max(
        root.scrollHeight,
        body.scrollHeight,
        document.documentElement.scrollHeight,
      );
      body.style.minHeight = Math.ceil(naturalHeight * scale + 32) + 'px';
    }

    function scheduleFit() {
      if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
      }
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        fit();
      });
    }

    window.addEventListener('load', scheduleFit);
    window.addEventListener('resize', scheduleFit);
    document.addEventListener('DOMContentLoaded', scheduleFit);

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(scheduleFit);
      observer.observe(document.documentElement);
    }

    scheduleFit();
  })();
`;

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

function buildMarketAppsPath(appId?: string, action?: string): string {
  if (!appId) return '/api/market-apps';
  if (!action) return `/api/market-apps/${encodeURIComponent(appId)}`;
  return `/api/market-apps/${encodeURIComponent(appId)}/${action}`;
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

function getBrowserHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
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

function getMarketAppIcon(app: MarketAppDescriptor) {
  switch (app.category) {
    case 'broker':
      return <Building2 className="h-4 w-4" />;
    case 'terminal':
      return <Monitor className="h-4 w-4" />;
    case 'charting':
      return <TrendingUp className="h-4 w-4" />;
    case 'research':
    default:
      return <BarChart3 className="h-4 w-4" />;
  }
}

function buildMarketDeskLinks(app: MarketAppDescriptor) {
  const seen = new Set<string>();
  const links = [
    { id: `${app.id}-home`, label: app.name, url: app.browserUrl },
    ...QUICK_BROWSER_LINKS.map((link) => ({ id: link.id, label: link.label, url: link.url })),
  ];

  return links.filter((link) => {
    if (!link.url || seen.has(link.url)) {
      return false;
    }
    seen.add(link.url);
    return true;
  });
}

function buildAdaptiveHtmlPreviewDocument(source: string): string {
  const injection = `
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${ADAPTIVE_RENDER_CSS}</style>
    <script>${ADAPTIVE_RENDER_SCRIPT}</script>
  `;

  const hasDocumentShell = /<html[\s>]/i.test(source) || /<!doctype/i.test(source);
  if (!hasDocumentShell) {
    return `<!doctype html><html><head>${injection}</head><body>${source}</body></html>`;
  }

  if (/<head[\s>]/i.test(source)) {
    return source.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${injection}`);
  }

  if (/<html(\s[^>]*)?>/i.test(source)) {
    return source.replace(/<html(\s[^>]*)?>/i, (match) => `${match}<head>${injection}</head>`);
  }

  return `${injection}${source}`;
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
          srcDoc={buildAdaptiveHtmlPreviewDocument(preview.content || '')}
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
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState<number | null>(null);

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

  useEffect(() => {
    if (status !== 'ready' || !renderNode) {
      setRenderScale(1);
      setScaledHeight(null);
      return;
    }

    let frameId = 0;
    const shell = previewShellRef.current;
    const canvas = previewCanvasRef.current;
    if (!shell || !canvas) {
      return;
    }

    const fitPreview = () => {
      const nextShell = previewShellRef.current;
      const nextCanvas = previewCanvasRef.current;
      if (!nextShell || !nextCanvas) return;

      const availableWidth = Math.max(nextShell.clientWidth - 32, 1);
      const naturalWidth = Math.max(nextCanvas.scrollWidth, nextCanvas.clientWidth, 1);
      const naturalHeight = Math.max(nextCanvas.scrollHeight, nextCanvas.clientHeight, 220);
      const nextScale = naturalWidth > availableWidth ? availableWidth / naturalWidth : 1;

      setRenderScale(nextScale);
      setScaledHeight(Math.ceil(naturalHeight * nextScale));
    };

    const scheduleFit = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        fitPreview();
      });
    };

    scheduleFit();

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          scheduleFit();
        })
      : null;

    resizeObserver?.observe(shell);
    resizeObserver?.observe(canvas);
    window.addEventListener('resize', scheduleFit);

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleFit);
    };
  }, [renderNode, status, preview.relativePath]);

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
      <div
        ref={previewShellRef}
        data-testid="chat-desk-component-preview-shell"
        className="h-full min-h-0 overflow-auto rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-black/20"
      >
        <ComponentPreviewErrorBoundary
          key={preview.relativePath}
          onError={(error) => {
            setStatus('error');
            setRenderError(error.message);
          }}
        >
          <div
            className="min-h-full"
            style={scaledHeight ? { minHeight: `${scaledHeight}px` } : undefined}
          >
            <div
              ref={previewCanvasRef}
              data-testid="chat-desk-component-preview"
              data-investclaw-component-preview-root="true"
              className="min-h-[220px] origin-top-left px-5 py-5 text-foreground"
              style={{
                transform: `scale(${renderScale})`,
                width: renderScale < 1 ? `${100 / renderScale}%` : '100%',
              }}
            >
              <style>{ADAPTIVE_COMPONENT_PREVIEW_CSS}</style>
              {renderNode}
            </div>
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
      <div className="flex h-full min-h-0 items-center justify-center rounded-[18px] border border-black/10 bg-white/80 dark:border-white/10 dark:bg-black/10">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (!preview) {
    return (
      <div
        data-testid="chat-desk-preview"
        className="flex h-full min-h-0 flex-col rounded-[18px] border border-dashed border-black/10 bg-white/80 px-5 pt-8 text-center dark:border-white/10 dark:bg-black/10"
      >
        <div data-testid="chat-desk-preview-empty-state" className="flex flex-col items-center">
          <FileText className="mb-3 h-5 w-5 text-foreground/45" />
          <p className="text-[13px] font-medium text-foreground/80">{t('desk.files.selectFile')}</p>
          <p className="mt-1 font-mono text-[11px] text-foreground/55">
            {fallbackPath}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="chat-desk-preview" className="flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border border-black/10 bg-white/80 dark:border-white/10 dark:bg-black/10">
      <div className="shrink-0 border-b border-black/10 px-3.5 py-2.5 dark:border-white/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-foreground">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl bg-black/[0.04] text-foreground/55 dark:bg-white/[0.06]">
                <FileText className="h-3.5 w-3.5 text-foreground/55" />
              </span>
              <span className="truncate">{preview.name}</span>
            </div>
            <p className="mt-1 break-all font-mono text-[11px] text-foreground/65">{preview.containerPath}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground/50">
              <span className="break-all font-mono">{preview.hostPath}</span>
              <span>{preview.mimeType}</span>
              <span>{formatByteSize(preview.size)}</span>
              <span>{formatTimestamp(preview.modifiedAt)}</span>
            </div>
          </div>
          {canRenderPreview && (
            <div className="flex shrink-0 items-center gap-1 rounded-[14px] border border-black/10 bg-black/[0.03] p-1 dark:border-white/10 dark:bg-white/[0.04]">
              <Button
                type="button"
                size="sm"
                variant={previewMode === 'render' ? 'secondary' : 'ghost'}
                data-testid="chat-desk-preview-mode-render"
                onClick={() => setPreviewMode('render')}
                className="h-6 rounded-[10px] px-2.5 text-[10px]"
              >
                {t('desk.files.render')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={previewMode === 'source' ? 'secondary' : 'ghost'}
                data-testid="chat-desk-preview-mode-source"
                onClick={() => setPreviewMode('source')}
                className="h-6 rounded-[10px] px-2.5 text-[10px]"
              >
                {t('desk.files.source')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {previewMode === 'render' && isHtmlWorkspacePreview(preview) && (
        <HtmlPreviewSurface preview={preview} />
      )}

      {previewMode === 'render' && isComponentWorkspacePreview(preview) && (
        <ComponentPreviewSurface preview={preview} />
      )}

      {preview.kind === 'image' && preview.dataUrl && (
        <div className="min-h-0 flex-1 overflow-auto p-2.5">
          <div className="overflow-hidden rounded-2xl border border-black/10 bg-white p-2.5 dark:border-white/10 dark:bg-black/20">
            <img src={preview.dataUrl} alt={preview.name} className="max-h-[520px] w-full rounded-xl object-contain" />
          </div>
        </div>
      )}

      {preview.kind === 'image' && !preview.dataUrl && (
        <div className="min-h-0 flex-1 p-2.5">
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
        <div className="min-h-0 flex-1 p-2.5">
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
                'flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-[14px] px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10',
                selectedWorkspacePath === entry.relativePath && 'bg-black/[0.07] dark:bg-white/[0.09]',
              )}
              style={{ paddingLeft: `${10 + depth * 16}px` }}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-foreground/45">
                {isDirectory ? (
                  <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')} />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-black/15 dark:bg-white/20" />
                )}
              </span>
              <span className="shrink-0 text-foreground/50">{getWorkspaceEntryIcon(entry)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-foreground">{entry.name}</p>
                <p className="truncate font-mono text-[10px] text-foreground/50">
                  {entry.containerPath} · {isDirectory ? t('desk.files.directory') : formatByteSize(entry.size)}
                </p>
              </div>
            </button>

            {isDirectory && isExpanded && (
              <div className="pt-1">
                {isLoadingDirectory && (
                  <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-foreground/55" style={{ paddingLeft: `${26 + depth * 16}px` }}>
                    <LoadingSpinner size="sm" />
                    {t('desk.files.loadingDirectory')}
                  </div>
                )}

                {!isLoadingDirectory && childListing && childListing.entries.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-foreground/55" style={{ paddingLeft: `${26 + depth * 16}px` }}>
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

function NativeAppsDock({
  apps,
  loading,
  error,
  drafts,
  savingAppIds,
  launchingAppIds,
  onRefresh,
  onDraftChange,
  onSavePath,
  onClearPath,
  onTogglePinned,
  onLaunch,
  onOpenBrowser,
  onOpenExternal,
  onReveal,
  onLaunchPinned,
  activeEmbeddedAppId,
  embedded = false,
}: {
  apps: MarketAppDescriptor[];
  loading: boolean;
  error: string | null;
  drafts: Record<string, string>;
  savingAppIds: Record<string, boolean>;
  launchingAppIds: Record<string, boolean>;
  onRefresh: () => void;
  onDraftChange: (appId: string, nextValue: string) => void;
  onSavePath: (appId: string) => void;
  onClearPath: (appId: string) => void;
  onTogglePinned: (app: MarketAppDescriptor) => void;
  onLaunch: (app: MarketAppDescriptor) => void;
  onOpenBrowser: (app: MarketAppDescriptor) => void;
  onOpenExternal: (url: string) => void;
  onReveal: (app: MarketAppDescriptor) => void;
  onLaunchPinned: () => void;
  activeEmbeddedAppId: string | null;
  embedded?: boolean;
}) {
  const { t } = useTranslation('chat');
  const pinnedApps = useMemo(() => apps.filter((app) => app.pinned), [apps]);
  const installedApps = useMemo(() => apps.filter((app) => app.installed), [apps]);
  const [focusedAppId, setFocusedAppId] = useState<string | null>(activeEmbeddedAppId);

  useEffect(() => {
    if (activeEmbeddedAppId) {
      setFocusedAppId(activeEmbeddedAppId);
      return;
    }

    setFocusedAppId((current) => {
      if (current && apps.some((app) => app.id === current)) {
        return current;
      }

      return apps.find((app) => app.installed)?.id ?? apps[0]?.id ?? null;
    });
  }, [activeEmbeddedAppId, apps]);

  return (
    <section
      data-testid="chat-market-apps-surface"
      className={cn(
        'flex min-h-0 flex-col overflow-hidden bg-[#10161d] text-white shadow-[0_20px_48px_rgba(6,10,15,0.22)]',
        embedded
          ? 'h-full rounded-[22px] border border-white/10'
          : 'rounded-[24px] border border-white/10',
      )}
    >
      <div
        data-testid="chat-market-app-dock-shell"
        className="shrink-0 border-b border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-3 py-2.5"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="max-w-sm">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <div className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] font-medium text-white/72">
                {t('desk.apps.title')}
              </div>
            </div>
            <p className="mt-2 text-[14px] font-semibold text-white">{t('desk.apps.title')}</p>
            <p className="mt-0.5 text-[11px] leading-5 text-white/58">{t('desk.apps.subtitle')}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              onClick={onLaunchPinned}
              disabled={loading || pinnedApps.length === 0}
              className="h-7 rounded-[12px] border-white/12 bg-white/6 px-2.5 text-[11px] text-white/78 hover:bg-white/10 hover:text-white disabled:bg-white/4 disabled:text-white/25"
            >
              <Rocket className="mr-1.5 h-3 w-3" />
              {t('desk.apps.launchPinned')}
            </Button>
            <Button
              variant="outline"
              onClick={onRefresh}
              className="h-7 rounded-[12px] border-white/12 bg-white/6 px-2.5 text-[11px] text-white/78 hover:bg-white/10 hover:text-white"
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              {t('desk.apps.refresh')}
            </Button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <div className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] text-white/64">
            {t('desk.apps.detectedCount', { count: installedApps.length })}
          </div>
          <div className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] text-white/64">
            {t('desk.apps.pinnedCount', { count: pinnedApps.length })}
          </div>
          {focusedAppId && (
            <div className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium text-emerald-200">
              {apps.find((app) => app.id === focusedAppId)?.name}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[12px] text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 bg-[#0b1116] p-2.5">
        {loading ? (
          <div className="flex h-full min-h-0 items-center justify-center">
            <LoadingSpinner size="md" />
          </div>
        ) : (
          <div className="flex min-h-full gap-2">
            <aside
              data-testid="chat-market-app-quick-rail"
              className="flex w-14 shrink-0 flex-col items-center rounded-[18px] border border-white/10 bg-white/[0.045] px-1.5 py-2"
            >
              <div className="mb-2 rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-white/45">
                {t('desk.apps.quickRail')}
              </div>
              <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto">
                {apps.map((app) => {
                  const isFocused = app.id === focusedAppId;
                  const isEmbedded = app.id === activeEmbeddedAppId;
                  return (
                    <button
                      key={`rail-${app.id}`}
                      type="button"
                      data-testid={`chat-market-app-quick-switch-${app.id}`}
                      onClick={() => {
                        setFocusedAppId(app.id);
                        onOpenBrowser(app);
                      }}
                      className={cn(
                        'group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border transition-colors',
                        isEmbedded
                          ? 'border-emerald-400/50 bg-emerald-400/12 text-emerald-200'
                          : isFocused
                            ? 'border-white/18 bg-white/[0.09] text-white'
                            : 'border-white/10 bg-white/[0.04] text-white/68 hover:bg-white/[0.08] hover:text-white',
                      )}
                      title={app.name}
                    >
                      {getMarketAppIcon(app)}
                      <span
                        className={cn(
                          'absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full',
                          app.installed ? 'bg-emerald-300' : 'bg-amber-300',
                        )}
                      />
                    </button>
                  );
                })}
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={onRefresh}
                className="mt-2 h-9 w-9 shrink-0 rounded-[14px] text-white/64 hover:bg-white/[0.08] hover:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </aside>

            <div className="min-w-0 flex-1 overflow-y-auto">
              <div className="space-y-2.5">
                {apps.map((app) => {
                  const draftValue = drafts[app.id] ?? app.customPath;
                  const isSaving = !!savingAppIds[app.id];
                  const isLaunching = !!launchingAppIds[app.id];
                  const hasRevealTarget = Boolean(app.installedPath);
                  const isFocused = app.id === focusedAppId;
                  const isEmbedded = app.id === activeEmbeddedAppId;
                  const browserHost = getBrowserHostname(app.browserUrl || app.websiteUrl);

                  return (
                    <article
                      key={app.id}
                      data-testid={`chat-market-app-card-${app.id}`}
                      className={cn(
                        'rounded-[18px] border px-3 py-3 shadow-sm transition-colors',
                        isEmbedded
                          ? 'border-emerald-400/50 bg-emerald-400/10 ring-1 ring-emerald-300/20'
                          : isFocused
                            ? 'border-white/16 bg-white/[0.08]'
                            : app.installed
                              ? 'border-white/10 bg-white/[0.045] hover:bg-white/[0.06]'
                              : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.05]',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setFocusedAppId(app.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-white/8 text-white/78">
                              {getMarketAppIcon(app)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold text-white">{app.name}</p>
                              <p className="truncate text-[11px] text-white/45">{app.vendor}</p>
                            </div>
                          </div>
                          <p className="mt-2 text-[11px] leading-5 text-white/62">{app.description}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] text-white/58">
                              {browserHost}
                            </span>
                            {(app.launchCount > 0 || app.lastLaunchedAt) && (
                              <span className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] text-white/52">
                                {t('desk.apps.launchMeta', {
                                  count: app.launchCount,
                                  time: app.lastLaunchedAt ? formatTimestamp(app.lastLaunchedAt) : '-',
                                })}
                              </span>
                            )}
                          </div>
                        </button>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-medium',
                              app.installed
                                ? 'bg-emerald-500/10 text-emerald-200'
                                : 'bg-amber-500/10 text-amber-200',
                            )}
                          >
                            {app.installed ? t('desk.apps.installed') : t('desk.apps.missing')}
                          </span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            data-testid={`chat-market-app-pin-${app.id}`}
                            className="h-7 w-7 rounded-full text-white/65 hover:bg-white/8 hover:text-white"
                            onClick={() => onTogglePinned(app)}
                          >
                            {app.pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          data-testid={`chat-market-app-browser-${app.id}`}
                          onMouseDown={(event) => {
                            if (event.button !== 0) return;
                            event.preventDefault();
                            setFocusedAppId(app.id);
                            onOpenBrowser(app);
                          }}
                          onClick={() => {
                            setFocusedAppId(app.id);
                            onOpenBrowser(app);
                          }}
                          className="h-8 rounded-[12px] bg-emerald-500/90 px-2.5 text-[11px] text-[#071016] hover:bg-emerald-400"
                        >
                          <Globe className="mr-1.5 h-3 w-3" />
                          {t('desk.apps.openInBrowser')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          data-testid={`chat-market-app-launch-${app.id}`}
                          disabled={!app.platformSupported || !app.installed || isLaunching}
                          onClick={() => onLaunch(app)}
                          className="h-8 rounded-[12px] border-white/12 bg-white/6 px-2.5 text-[11px] text-white/78 hover:bg-white/10 hover:text-white disabled:bg-white/4 disabled:text-white/25"
                        >
                          {isLaunching ? <LoadingSpinner size="sm" /> : <Play className="mr-1.5 h-3 w-3" />}
                          {t('desk.apps.launch')}
                        </Button>
                      </div>

                      {isFocused && (
                        <div
                          data-testid={`chat-market-app-inspector-${app.id}`}
                          className="mt-2.5 rounded-[16px] border border-white/10 bg-black/[0.18] p-2.5"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              data-testid={`chat-market-app-website-${app.id}`}
                              onClick={() => onOpenExternal(app.websiteUrl)}
                              className="h-7 rounded-[11px] border-white/12 bg-white/6 px-2.5 text-[10px] text-white/72 hover:bg-white/10 hover:text-white"
                            >
                              <ExternalLink className="mr-1.5 h-3 w-3" />
                              {t('desk.apps.website')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              data-testid={`chat-market-app-download-${app.id}`}
                              onClick={() => onOpenExternal(app.downloadUrl)}
                              className="h-7 rounded-[11px] border-white/12 bg-white/6 px-2.5 text-[10px] text-white/72 hover:bg-white/10 hover:text-white"
                            >
                              <Download className="mr-1.5 h-3 w-3" />
                              {t('desk.apps.download')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              data-testid={`chat-market-app-reveal-${app.id}`}
                              disabled={!hasRevealTarget}
                              onClick={() => onReveal(app)}
                              className="h-7 rounded-[11px] border-white/12 bg-white/6 px-2.5 text-[10px] text-white/72 hover:bg-white/10 hover:text-white disabled:bg-white/4 disabled:text-white/25"
                            >
                              <FolderOpen className="mr-1.5 h-3 w-3" />
                              {t('desk.apps.reveal')}
                            </Button>
                          </div>

                          <div className="mt-2 rounded-[14px] border border-white/10 bg-white/[0.05] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.08em] text-white/42">
                              {app.installed ? t('desk.apps.detectedPath') : t('desk.apps.pathHint')}
                            </p>
                            <p className="mt-1 break-all font-mono text-[11px] text-white/72">
                              {app.installedPath || app.candidatePaths[0] || t('desk.apps.noHint')}
                            </p>
                          </div>

                          <div className="mt-2">
                            <label className="mb-1.5 block text-[10px] uppercase tracking-[0.08em] text-white/42">
                              {t('desk.apps.customPath')}
                            </label>
                            <div className="flex flex-col gap-2">
                              <Input
                                value={draftValue}
                                onChange={(event) => onDraftChange(app.id, event.target.value)}
                                placeholder={app.candidatePaths[0] || t('desk.apps.customPathPlaceholder')}
                                className="h-8 border-white/10 bg-white/[0.03] text-[11px] text-white shadow-none placeholder:text-white/25"
                              />
                              <div className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  data-testid={`chat-market-app-save-${app.id}`}
                                  disabled={isSaving}
                                  onClick={() => onSavePath(app.id)}
                                  className="h-8 rounded-[12px] border-white/12 bg-white/6 px-2.5 text-[11px] text-white/78 hover:bg-white/10 hover:text-white"
                                >
                                  {isSaving ? <LoadingSpinner size="sm" /> : null}
                                  {t('desk.apps.save')}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  data-testid={`chat-market-app-clear-${app.id}`}
                                  disabled={isSaving || !draftValue}
                                  onClick={() => onClearPath(app.id)}
                                  className="h-8 rounded-[12px] px-2.5 text-[11px] text-white/62 hover:bg-white/8 hover:text-white"
                                >
                                  {t('desk.apps.clear')}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function EmbeddedMarketAppPane({
  app,
  state,
  interactive,
  surfaceRef,
  onSetInteractive,
  onGoBack,
  onGoForward,
  onReload,
  onStateChange,
  onRegisterWebview,
  onOpenExternal,
  onLaunch,
  onNavigate,
  onSuggestPrompt,
  currentAgentName,
}: {
  app: MarketAppDescriptor | null;
  state: BrowserTabState | null;
  interactive: boolean;
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  onSetInteractive: (nextValue: boolean) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onStateChange: (tabId: string, patch: Partial<BrowserTabState>) => void;
  onRegisterWebview: (tabId: string, webview: BrowserWebview | null) => void;
  onOpenExternal: (url: string) => void;
  onLaunch: (app: MarketAppDescriptor) => void;
  onNavigate: (url: string, fallbackTitle: string) => void;
  onSuggestPrompt?: (prompt: string) => void;
  currentAgentName?: string | null;
}) {
  const { t } = useTranslation('chat');
  const hostname = state ? getBrowserHostname(state.url) : '';
  const interactionLabel = interactive ? t('desk.apps.interactiveOn') : t('desk.apps.readOnly');
  const quickLinks = useMemo(() => (app ? buildMarketDeskLinks(app) : []), [app]);
  const aiActions = useMemo(() => {
    if (!app || !state) return [];
    const promptHeader = `请基于当前终端 ${app.name}（来源：${hostname}，URL：${state.url}）辅助我完成分析。`;
    const agentContext = currentAgentName ? `当前对话对象是 ${currentAgentName}。` : '';
    return [
      {
        id: 'pulse',
        label: t('desk.apps.aiPulse'),
        prompt: `${promptHeader}${agentContext} 请先给我一份市场脉冲简报，包含当前关注点、关键催化剂、需要盯住的风险，以及接下来最值得继续追踪的三个方向。`,
      },
      {
        id: 'earnings',
        label: t('desk.apps.aiEarnings'),
        prompt: `${promptHeader}${agentContext} 请从财报交易角度拆解这个标的/终端信息，输出核心基本面变化、指引、市场预期差，以及多空双方最关键的判断依据。`,
      },
      {
        id: 'trade',
        label: t('desk.apps.aiTrade'),
        prompt: `${promptHeader}${agentContext} 请把当前信息整理成一份交易计划，包含方向假设、触发条件、仓位与风控、失效条件，以及还缺哪些确认信号。`,
      },
      {
        id: 'risk',
        label: t('desk.apps.aiRisk'),
        prompt: `${promptHeader}${agentContext} 请做一份风险雷达，列出宏观、流动性、监管、情绪和个股层面的潜在风险，并按优先级排序。`,
      },
    ];
  }, [app, state, hostname, currentAgentName, t]);

  if (!app || !state) {
    return (
      <section
        data-testid="chat-market-app-embed-surface"
        className="flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-white/10 bg-[#10161d] text-white shadow-[0_24px_60px_rgba(6,10,15,0.28)]"
      >
        <div className="shrink-0 border-b border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <div className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] font-medium text-white/70">
              {t('desk.apps.nativeShell')}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div
            data-testid="chat-market-app-embed-empty"
            className="max-w-md rounded-[18px] border border-dashed border-white/10 bg-white/5 px-4 py-5 text-center"
          >
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-white/8 text-white/70">
              <Monitor className="h-[18px] w-[18px]" />
            </div>
            <p className="mt-3 text-[13px] font-semibold text-white">{t('desk.apps.embedEmptyTitle')}</p>
            <p className="mt-1.5 text-[11px] leading-5 text-white/65">{t('desk.apps.embedEmptyBody')}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-testid="chat-market-app-embed-surface"
      className="flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-white/10 bg-[#10161d] text-white shadow-[0_24px_60px_rgba(6,10,15,0.28)]"
    >
      <div
        data-testid="chat-market-app-native-shell"
        className="shrink-0 border-b border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-3 py-1.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl bg-white/8 text-white/75">
              {getMarketAppIcon(app)}
            </span>
            <div className="min-w-0">
              <p data-testid="chat-market-app-embed-title" className="truncate text-[13px] font-semibold text-white">
                {app.name}
              </p>
              <p className="truncate text-[10px] text-white/45">
                {app.vendor} · {hostname}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button
              variant="outline"
              onClick={onGoBack}
              disabled={!state.canGoBack}
              className="h-7 rounded-[11px] border-white/12 bg-white/6 px-2.5 text-[10px] text-white/78 hover:bg-white/10 hover:text-white disabled:bg-white/4 disabled:text-white/25"
            >
              {t('desk.browser.back')}
            </Button>
            <Button
              variant="outline"
              onClick={onGoForward}
              disabled={!state.canGoForward}
              className="h-7 rounded-[11px] border-white/12 bg-white/6 px-2.5 text-[10px] text-white/78 hover:bg-white/10 hover:text-white disabled:bg-white/4 disabled:text-white/25"
            >
              {t('desk.browser.forward')}
            </Button>
            <Button
              variant="outline"
              onClick={onReload}
              className="h-7 rounded-[11px] border-white/12 bg-white/6 px-2.5 text-[10px] text-white/78 hover:bg-white/10 hover:text-white"
            >
              <RefreshCw className={cn('mr-1.5 h-3 w-3', state.loading && 'animate-spin')} />
              {t('desk.browser.reload')}
            </Button>
            {app.installed && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-[11px] border-white/12 bg-white/6 px-2.5 text-[10px] text-white/78 hover:bg-white/10 hover:text-white"
                onClick={() => onLaunch(app)}
              >
                <Play className="mr-1.5 h-3 w-3" />
                {t('desk.apps.launch')}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-[11px] border-white/12 bg-white/6 px-2.5 text-[10px] text-white/78 hover:bg-white/10 hover:text-white"
              onClick={() => onOpenExternal(app.websiteUrl)}
            >
              <ExternalLink className="mr-1.5 h-3 w-3" />
              {t('desk.browser.openExternal')}
            </Button>
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <div className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] font-medium text-white/72">
            {t('desk.apps.nativeShell')}
          </div>
          <div className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] text-white/58">
            {t('desk.apps.webEntry')}: {hostname}
          </div>
          <div className="rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] text-white/58">
            {interactionLabel}
          </div>
        </div>

        {quickLinks.length > 0 && (
          <div
            data-testid="chat-market-app-command-strip"
            className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5"
          >
            <div className="shrink-0 rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] font-medium text-white/55">
              {t('desk.apps.quickDeck')}
            </div>
            {quickLinks.map((link) => (
              <button
                key={link.id}
                type="button"
                data-testid={`chat-market-app-command-${link.id}`}
                onClick={() => onNavigate(link.url, link.label)}
                className={cn(
                  'shrink-0 rounded-full border px-2.5 py-1 text-[10px] transition-colors',
                  state.url === normalizeBrowserUrl(link.url)
                    ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'
                    : 'border-white/10 bg-white/6 text-white/64 hover:bg-white/10 hover:text-white',
                )}
              >
                {link.label}
              </button>
            ))}
          </div>
        )}

        {aiActions.length > 0 && (
          <div
            data-testid="chat-market-app-ai-deck"
            className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5"
          >
            <div className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium text-emerald-200">
              {t('desk.apps.aiDeck')}
            </div>
            {aiActions.map((action) => (
              <button
                key={action.id}
                type="button"
                data-testid={`chat-market-app-ai-action-${action.id}`}
                onClick={() => onSuggestPrompt?.(action.prompt)}
                className="shrink-0 rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[10px] text-white/68 transition-colors hover:bg-white/10 hover:text-white"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        ref={surfaceRef}
        data-testid="chat-market-app-native-canvas"
        className="min-h-0 flex-1 bg-[#0b1116] p-2.5"
      >
        <div className="relative h-full overflow-hidden rounded-[18px] border border-white/10 bg-white shadow-[0_24px_60px_rgba(0,0,0,0.36)]">
          <BrowserWebviewPane
            tab={state}
            active
            interactive={interactive}
            fallbackTitle={app.name}
            testId="chat-market-app-embedded-webview"
            partition="persist:investclaw-market-apps"
            onStateChange={onStateChange}
            onRegisterWebview={onRegisterWebview}
          />

          {!state.error && !interactive && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-gradient-to-b from-[#0b1116]/10 via-transparent to-[#0b1116]/36 p-5">
              <button
                type="button"
                data-testid="chat-market-app-activate"
                onClick={() => onSetInteractive(true)}
                className="max-w-sm rounded-[18px] border border-black/10 bg-white/94 px-4 py-3 text-center shadow-xl transition-transform hover:-translate-y-0.5"
              >
                <p className="text-[13px] font-semibold text-foreground">{t('desk.apps.activate')}</p>
                <p className="mt-2 text-[11px] leading-6 text-foreground/65">{t('desk.apps.activateBody')}</p>
              </button>
            </div>
          )}

          {state.error && (
            <div
              data-testid="chat-market-app-embed-error"
              className="absolute inset-0 z-10 flex items-center justify-center bg-[#0b1116]/70 p-5"
            >
              <div className="w-full max-w-md rounded-[18px] border border-black/10 bg-white/94 p-4 shadow-xl">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-destructive/10 p-2 text-destructive">
                    <AlertCircle className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-foreground">{t('desk.browser.loadFailedTitle')}</p>
                    <p className="mt-1 text-[12px] leading-6 text-foreground/70">{t('desk.browser.loadFailedBody')}</p>
                    <p className="mt-3 break-all rounded-[14px] border border-black/10 bg-black/[0.03] px-3 py-2 font-mono text-[11px] text-foreground/70">
                      {state.error.url}
                    </p>
                    <p className="mt-2 text-[11px] text-foreground/55">{state.error.description}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    className="h-8 rounded-[12px] px-3 text-[11px]"
                    onClick={onReload}
                  >
                    <RefreshCw className="mr-1.5 h-3 w-3" />
                    {t('desk.browser.retry')}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-8 rounded-[12px] px-3 text-[11px]"
                    onClick={() => onOpenExternal(state.error?.url || state.url)}
                  >
                    <ExternalLink className="mr-1.5 h-3 w-3" />
                    {t('desk.browser.openExternal')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 bg-black/[0.18] px-3 py-1.5 text-[10px] text-white/46">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{hostname}</span>
          <span>•</span>
          <span>{interactionLabel}</span>
          {state.loading && (
            <>
              <span>•</span>
              <span>{t('desk.browser.loading')}</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function BrowserWebviewPane({
  tab,
  active,
  interactive,
  fallbackTitle,
  testId = 'chat-desk-browser-webview',
  partition = 'persist:investclaw-browser',
  onStateChange,
  onRegisterWebview,
}: {
  tab: BrowserTabState;
  active: boolean;
  interactive: boolean;
  fallbackTitle: string;
  testId?: string;
  partition?: string;
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
      data-testid={active ? testId : undefined}
      src={tab.url}
      allowpopups={true}
      partition={partition}
      className={cn(
        'absolute inset-0 h-full w-full',
        active && interactive ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-100',
      )}
    />
  );
}

export function ResearchDeskPanel({
  currentAgent,
  onSuggestPrompt,
}: {
  currentAgent: AgentSummary | null;
  onSuggestPrompt?: (prompt: string) => void;
}) {
  const { t } = useTranslation('chat');
  const browserWebviewsRef = useRef<Record<string, BrowserWebview | null>>({});
  const browserSurfaceRef = useRef<HTMLDivElement | null>(null);
  const embeddedMarketWebviewRef = useRef<BrowserWebview | null>(null);
  const embeddedMarketSurfaceRef = useRef<HTMLDivElement | null>(null);
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
  const [browserInteractive, setBrowserInteractive] = useState(false);
  const [activeDeskView, setActiveDeskView] = useState<DeskView>('files');
  const [marketApps, setMarketApps] = useState<MarketAppDescriptor[]>([]);
  const [marketAppsLoading, setMarketAppsLoading] = useState(false);
  const [marketAppsError, setMarketAppsError] = useState<string | null>(null);
  const [marketAppDrafts, setMarketAppDrafts] = useState<Record<string, string>>({});
  const [savingAppIds, setSavingAppIds] = useState<Record<string, boolean>>({});
  const [launchingAppIds, setLaunchingAppIds] = useState<Record<string, boolean>>({});
  const [activeEmbeddedMarketAppId, setActiveEmbeddedMarketAppId] = useState<string | null>(null);
  const [embeddedMarketState, setEmbeddedMarketState] = useState<BrowserTabState | null>(null);
  const [embeddedMarketInteractive, setEmbeddedMarketInteractive] = useState(false);

  const rootListing = workspaceListings[ROOT_WORKSPACE_PATH] || null;
  const activeBrowserTab = browserTabs.find((tab) => tab.id === activeBrowserTabId) || browserTabs[0];
  const activeEmbeddedMarketApp = marketApps.find((app) => app.id === activeEmbeddedMarketAppId) || null;

  const updateBrowserTab = useCallback((tabId: string, patch: Partial<BrowserTabState>) => {
    setBrowserTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  const registerBrowserWebview = useCallback((tabId: string, webview: BrowserWebview | null) => {
    browserWebviewsRef.current[tabId] = webview;
  }, []);

  const updateEmbeddedMarketState = useCallback((tabId: string, patch: Partial<BrowserTabState>) => {
    setEmbeddedMarketState((current) => {
      if (!current || current.id !== tabId) return current;
      const next = { ...current, ...patch };
      const unchanged = (
        next.url === current.url
        && next.title === current.title
        && next.loading === current.loading
        && next.canGoBack === current.canGoBack
        && next.canGoForward === current.canGoForward
        && next.error?.code === current.error?.code
        && next.error?.description === current.error?.description
        && next.error?.url === current.error?.url
      );
      return unchanged ? current : next;
    });
  }, []);

  const registerEmbeddedMarketWebview = useCallback((_tabId: string, webview: BrowserWebview | null) => {
    embeddedMarketWebviewRef.current = webview;
  }, []);

  const replaceMarketApp = useCallback((nextApp: MarketAppDescriptor) => {
    setMarketApps((current) => {
      const merged = current.map((item) => (item.id === nextApp.id ? nextApp : item));
      return [...merged].sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        if (left.installed !== right.installed) return left.installed ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
    });
    setMarketAppDrafts((current) => ({ ...current, [nextApp.id]: nextApp.customPath }));
  }, []);

  const loadMarketApps = useCallback(async () => {
    setMarketAppsLoading(true);
    try {
      const response = await hostApiFetch<MarketAppsSnapshot>(buildMarketAppsPath());
      setMarketApps(response.apps);
      setMarketAppDrafts(Object.fromEntries(response.apps.map((app) => [app.id, app.customPath])));
      setMarketAppsError(null);
    } catch (error) {
      setMarketAppsError(String(error));
      setMarketApps([]);
    } finally {
      setMarketAppsLoading(false);
    }
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
    void loadMarketApps();
  }, [loadMarketApps]);

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
    if (!webview) return;

    updateBrowserTab(tabId, {
      canGoBack: safeCanGoBack(webview),
      canGoForward: safeCanGoForward(webview),
    });
  }, [updateBrowserTab]);

  useEffect(() => {
    if (!activeBrowserTab) return;
    syncActiveBrowserNavigation(activeBrowserTab.id);
  }, [activeBrowserTab, syncActiveBrowserNavigation]);

  useEffect(() => {
    if (!browserInteractive) return;

    const handlePointerDown = (event: PointerEvent) => {
      const browserSurface = browserSurfaceRef.current;
      if (!browserSurface) return;
      if (browserSurface.contains(event.target as Node)) return;
      setBrowserInteractive(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [browserInteractive]);

  useEffect(() => {
    if (!embeddedMarketInteractive) return;

    const handlePointerDown = (event: PointerEvent) => {
      const marketSurface = embeddedMarketSurfaceRef.current;
      if (!marketSurface) return;
      if (marketSurface.contains(event.target as Node)) return;
      setEmbeddedMarketInteractive(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [embeddedMarketInteractive]);

  useEffect(() => {
    if (!activeEmbeddedMarketAppId) return;
    if (marketApps.some((app) => app.id === activeEmbeddedMarketAppId)) return;
    setActiveEmbeddedMarketAppId(null);
    setEmbeddedMarketState(null);
    setEmbeddedMarketInteractive(false);
  }, [activeEmbeddedMarketAppId, marketApps]);

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
    setBrowserInteractive(false);
    setActiveDeskView('browser');
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
    setBrowserInteractive(false);
    setActiveDeskView('browser');
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

  const navigateBrowserTo = useCallback((targetUrl: string, fallbackTitle: string) => {
    const nextUrl = normalizeBrowserUrl(targetUrl);
    const nextTitle = getBrowserTitleFallback(nextUrl, fallbackTitle);
    const targetTabId = activeBrowserTab?.id || activeBrowserTabId;

    setBrowserInput(nextUrl);
    setBrowserInteractive(false);
    setActiveDeskView('browser');

    if (!targetTabId) {
      const nextTab = createBrowserTab(nextUrl, fallbackTitle);
      setBrowserTabs([nextTab]);
      setActiveBrowserTabId(nextTab.id);
      return;
    }

    setActiveBrowserTabId(targetTabId);
    updateBrowserTab(targetTabId, {
      url: nextUrl,
      title: nextTitle,
      loading: true,
      error: null,
    });
  }, [activeBrowserTab, activeBrowserTabId, updateBrowserTab]);

  const handleOpenExternalUrl = useCallback(async (url: string) => {
    try {
      await invokeIpc('shell:openExternal', url);
    } catch (error) {
      setMarketAppsError(String(error));
    }
  }, []);

  const handleSaveAppPath = useCallback(async (appId: string) => {
    const nextPath = marketAppDrafts[appId] ?? '';
    setSavingAppIds((current) => ({ ...current, [appId]: true }));
    try {
      const response = await hostApiFetch<{ success?: boolean; app: MarketAppDescriptor }>(buildMarketAppsPath(appId), {
        method: 'PUT',
        body: JSON.stringify({ customPath: nextPath }),
      });
      replaceMarketApp(response.app);
      setMarketAppsError(null);
    } catch (error) {
      setMarketAppsError(String(error));
    } finally {
      setSavingAppIds((current) => {
        const next = { ...current };
        delete next[appId];
        return next;
      });
    }
  }, [marketAppDrafts, replaceMarketApp]);

  const handleClearAppPath = useCallback(async (appId: string) => {
    setMarketAppDrafts((current) => ({ ...current, [appId]: '' }));
    setSavingAppIds((current) => ({ ...current, [appId]: true }));
    try {
      const response = await hostApiFetch<{ success?: boolean; app: MarketAppDescriptor }>(buildMarketAppsPath(appId), {
        method: 'PUT',
        body: JSON.stringify({ customPath: '' }),
      });
      replaceMarketApp(response.app);
      setMarketAppsError(null);
    } catch (error) {
      setMarketAppsError(String(error));
    } finally {
      setSavingAppIds((current) => {
        const next = { ...current };
        delete next[appId];
        return next;
      });
    }
  }, [replaceMarketApp]);

  const handleTogglePinned = useCallback(async (app: MarketAppDescriptor) => {
    setSavingAppIds((current) => ({ ...current, [app.id]: true }));
    try {
      const response = await hostApiFetch<{ success?: boolean; app: MarketAppDescriptor }>(buildMarketAppsPath(app.id), {
        method: 'PUT',
        body: JSON.stringify({ pinned: !app.pinned }),
      });
      replaceMarketApp(response.app);
      setMarketAppsError(null);
    } catch (error) {
      setMarketAppsError(String(error));
    } finally {
      setSavingAppIds((current) => {
        const next = { ...current };
        delete next[app.id];
        return next;
      });
    }
  }, [replaceMarketApp]);

  const handleLaunchApp = useCallback(async (app: MarketAppDescriptor) => {
    setLaunchingAppIds((current) => ({ ...current, [app.id]: true }));
    try {
      const response = await hostApiFetch<{ success?: boolean; app: MarketAppDescriptor }>(buildMarketAppsPath(app.id, 'launch'), {
        method: 'POST',
      });
      replaceMarketApp(response.app);
      setMarketAppsError(null);
    } catch (error) {
      setMarketAppsError(String(error));
    } finally {
      setLaunchingAppIds((current) => {
        const next = { ...current };
        delete next[app.id];
        return next;
      });
    }
  }, [replaceMarketApp]);

  const handleEmbedMarketApp = useCallback((app: MarketAppDescriptor) => {
    const nextUrl = normalizeBrowserUrl(app.browserUrl);
    setActiveDeskView('apps');
    setActiveEmbeddedMarketAppId(app.id);
    setEmbeddedMarketState({
      id: app.id,
      url: nextUrl,
      title: app.name,
      loading: true,
      canGoBack: false,
      canGoForward: false,
      error: null,
    });
    setEmbeddedMarketInteractive(false);
  }, []);

  const syncEmbeddedMarketNavigation = useCallback(() => {
    const webview = embeddedMarketWebviewRef.current;
    if (!webview || !embeddedMarketState) return;

    updateEmbeddedMarketState(embeddedMarketState.id, {
      canGoBack: safeCanGoBack(webview),
      canGoForward: safeCanGoForward(webview),
      url: safeGetBrowserUrl(webview) || embeddedMarketState.url,
    });
  }, [embeddedMarketState, updateEmbeddedMarketState]);

  useEffect(() => {
    syncEmbeddedMarketNavigation();
  }, [syncEmbeddedMarketNavigation]);

  const handleEmbeddedMarketGoBack = useCallback(() => {
    const webview = embeddedMarketWebviewRef.current;
    if (!webview || !embeddedMarketState) return;
    webview.goBack();
    syncEmbeddedMarketNavigation();
  }, [embeddedMarketState, syncEmbeddedMarketNavigation]);

  const handleEmbeddedMarketGoForward = useCallback(() => {
    const webview = embeddedMarketWebviewRef.current;
    if (!webview || !embeddedMarketState) return;
    webview.goForward();
    syncEmbeddedMarketNavigation();
  }, [embeddedMarketState, syncEmbeddedMarketNavigation]);

  const handleEmbeddedMarketReload = useCallback(() => {
    const webview = embeddedMarketWebviewRef.current;
    if (!webview || !embeddedMarketState) return;
    updateEmbeddedMarketState(embeddedMarketState.id, { loading: true, error: null });
    webview.reload();
  }, [embeddedMarketState, updateEmbeddedMarketState]);

  const handleLaunchPinnedApps = useCallback(async () => {
    for (const app of marketApps.filter((item) => item.pinned && item.installed)) {
      // eslint-disable-next-line no-await-in-loop
      await handleLaunchApp(app);
    }
  }, [handleLaunchApp, marketApps]);

  const handleRevealApp = useCallback(async (app: MarketAppDescriptor) => {
    if (!app.installedPath) return;
    try {
      await invokeIpc('shell:showItemInFolder', app.installedPath);
    } catch (error) {
      setMarketAppsError(String(error));
    }
  }, []);

  const workspaceFallbackPath = workspacePreview?.containerPath || rootListing?.currentContainerPath || '/workspace';
  const workspaceHostPath = rootListing?.hostPath || currentAgent?.workspace || '-';
  const installedAppCount = marketApps.filter((app) => app.installed).length;

  const activeBrowserState = useMemo(() => ({
    title: activeBrowserTab?.title || t('desk.browser.title'),
    loading: activeBrowserTab?.loading ?? false,
    canGoBack: activeBrowserTab?.canGoBack ?? false,
    canGoForward: activeBrowserTab?.canGoForward ?? false,
  }), [activeBrowserTab, t]);

  const getDeskViewButtonClass = (view: DeskView) => cn(
    'h-7 rounded-[12px] px-2.5 text-[10px] font-medium transition-colors',
    activeDeskView === view
      ? 'bg-white text-foreground shadow-sm dark:bg-black/20'
      : 'text-foreground/60 hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06] dark:hover:text-foreground',
  );

  return (
    <Card data-testid="chat-research-desk" className="flex h-full min-h-[340px] flex-col rounded-[26px] border-0 bg-[#efe9db] shadow-[0_24px_80px_rgba(36,39,27,0.12)] dark:bg-card">
      <CardContent className="flex min-h-0 flex-1 flex-col p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 rounded-[16px] border border-black/10 bg-white/55 px-2 py-1.5 dark:border-white/10 dark:bg-white/[0.04]">
          <div
            data-testid="chat-desk-view-switcher"
            className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-[14px] border border-black/10 bg-white/65 p-0.5 dark:border-white/10 dark:bg-white/[0.05]"
          >
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="chat-desk-view-files"
              onClick={() => setActiveDeskView('files')}
              className={getDeskViewButtonClass('files')}
            >
              <FolderOpen className="mr-1.5 h-3 w-3" />
              {t('desk.files.title')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="chat-desk-view-apps"
              onClick={() => setActiveDeskView('apps')}
              className={getDeskViewButtonClass('apps')}
            >
              <Monitor className="mr-1.5 h-3 w-3" />
              {t('desk.apps.title')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="chat-desk-view-browser"
              onClick={() => setActiveDeskView('browser')}
              className={getDeskViewButtonClass('browser')}
            >
              <Globe className="mr-1.5 h-3 w-3" />
              {t('desk.browser.title')}
            </Button>
          </div>

          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <div className="flex max-w-[140px] items-center gap-1.5 rounded-full border border-black/10 bg-white/75 px-2 py-1 text-[10px] font-medium text-foreground/80 dark:border-white/10 dark:bg-white/[0.08]">
              <span className="truncate">{currentAgent?.name || 'Main Agent'}</span>
            </div>
            <div className="hidden rounded-full border border-black/10 bg-white/70 px-2 py-1 text-[10px] font-medium text-foreground/55 dark:border-white/10 dark:bg-white/[0.06] xl:block">
              {t('desk.apps.detectedCount', { count: installedAppCount })}
            </div>
            <div className="hidden min-w-0 max-w-[260px] rounded-full border border-black/10 bg-white/55 px-2.5 py-1 font-mono text-[10px] text-foreground/55 dark:border-white/10 dark:bg-white/[0.05] 2xl:block">
              <span className="block truncate">{workspaceHostPath}</span>
            </div>
          </div>
        </div>

        <div data-testid="chat-desk-active-view" className="min-h-0 flex-1">
          {activeDeskView === 'files' && (
            <section
              data-testid="chat-desk-files-surface"
              className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-black/10 bg-[#f9f6ec] dark:border-white/10 dark:bg-white/5"
            >
              <div data-testid="chat-desk-files-header" className="shrink-0 border-b border-black/10 px-3 py-2.5 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[14px] font-semibold text-foreground">{t('desk.files.title')}</p>
                    <p className="text-[11px] text-foreground/58">{t('desk.files.subtitle')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => void handleRefreshWorkspace()}
                      className="h-7 rounded-[12px] border-black/10 bg-white/80 px-2.5 text-[11px] dark:border-white/10 dark:bg-white/5"
                    >
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                      {t('desk.files.refresh')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleOpenWorkspaceFolder()}
                      disabled={!rootListing?.exists}
                      className="h-7 rounded-[12px] border-black/10 bg-white/80 px-2.5 text-[11px] dark:border-white/10 dark:bg-white/5"
                    >
                      <FolderOpen className="mr-1.5 h-3 w-3" />
                      {t('desk.files.openFolder')}
                    </Button>
                  </div>
                </div>
                <div className="mt-2.5 rounded-[18px] border border-black/10 bg-white/80 px-3 py-2.5 dark:border-white/10 dark:bg-black/10">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-foreground/55">
                    <Folder className="h-3 w-3" />
                    {t('desk.files.containerPath')}
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-foreground">
                    {workspaceFallbackPath}
                  </p>
                </div>
                {workspaceError && (
                  <div className="mt-2.5 rounded-[18px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-[12px] text-destructive">
                    {workspaceError}
                  </div>
                )}
              </div>

              <div className="grid min-h-0 flex-1 gap-px bg-black/10 dark:bg-white/10 lg:grid-cols-[minmax(228px,0.74fr)_minmax(0,1.26fr)]">
                <div
                  data-testid="chat-desk-files"
                  className="flex min-h-0 flex-col overflow-hidden bg-[#f9f6ec] p-2.5 dark:bg-white/5"
                >
                  {!currentAgent ? (
                    <div className="rounded-[18px] border border-dashed border-black/10 bg-white/70 p-3.5 text-[12px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
                      {t('desk.files.noAgent')}
                    </div>
                  ) : workspaceLoading ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center">
                      <LoadingSpinner size="md" />
                    </div>
                  ) : !rootListing?.exists ? (
                    <div className="rounded-[18px] border border-dashed border-black/10 bg-white/70 p-3.5 text-[12px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
                      {t('desk.files.missing')}
                    </div>
                  ) : rootListing.entries.length === 0 ? (
                    <div className="rounded-[18px] border border-dashed border-black/10 bg-white/70 p-3.5 text-[12px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
                      {t('desk.files.empty')}
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                      <div data-testid="chat-desk-tree-root" className="mb-2 flex items-center gap-2 rounded-[14px] border border-black/10 bg-white/70 px-2.5 py-2 text-[11px] font-medium text-foreground/75 dark:border-white/10 dark:bg-black/10">
                        <FolderOpen className="h-3.5 w-3.5 text-foreground/55" />
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

                <div className="flex min-h-0 flex-col overflow-hidden bg-[#f9f6ec] p-2.5 dark:bg-white/5">
                  <WorkspacePreviewPane
                    preview={workspacePreview}
                    loading={workspacePreviewLoading}
                    fallbackPath={workspaceFallbackPath}
                  />
                </div>
              </div>
            </section>
          )}

          {activeDeskView === 'apps' && (
            <section className="grid h-full min-h-0 gap-2 md:grid-cols-[minmax(184px,0.46fr)_minmax(0,1.54fr)]">
              <NativeAppsDock
                embedded
                apps={marketApps}
                loading={marketAppsLoading}
                error={marketAppsError}
                drafts={marketAppDrafts}
                savingAppIds={savingAppIds}
                launchingAppIds={launchingAppIds}
                activeEmbeddedAppId={activeEmbeddedMarketAppId}
                onRefresh={() => void loadMarketApps()}
                onDraftChange={(appId, nextValue) => {
                  setMarketAppDrafts((current) => ({ ...current, [appId]: nextValue }));
                }}
                onSavePath={(appId) => {
                  void handleSaveAppPath(appId);
                }}
                onClearPath={(appId) => {
                  void handleClearAppPath(appId);
                }}
                onTogglePinned={(app) => {
                  void handleTogglePinned(app);
                }}
                onLaunch={(app) => {
                  void handleLaunchApp(app);
                }}
                onOpenBrowser={(app) => {
                  handleEmbedMarketApp(app);
                }}
                onOpenExternal={(url) => {
                  void handleOpenExternalUrl(url);
                }}
                onReveal={(app) => {
                  void handleRevealApp(app);
                }}
                onLaunchPinned={() => {
                  void handleLaunchPinnedApps();
                }}
              />

              <EmbeddedMarketAppPane
                app={activeEmbeddedMarketApp}
                state={embeddedMarketState}
                interactive={embeddedMarketInteractive}
                surfaceRef={embeddedMarketSurfaceRef}
                onSetInteractive={setEmbeddedMarketInteractive}
                onGoBack={handleEmbeddedMarketGoBack}
                onGoForward={handleEmbeddedMarketGoForward}
                onReload={handleEmbeddedMarketReload}
                onStateChange={updateEmbeddedMarketState}
                onRegisterWebview={registerEmbeddedMarketWebview}
                onOpenExternal={(url) => {
                  void handleOpenExternalUrl(url);
                }}
                onLaunch={(app) => {
                  void handleLaunchApp(app);
                }}
                onNavigate={(url, fallbackTitle) => {
                  const nextUrl = normalizeBrowserUrl(url);
                  if (!embeddedMarketState) return;
                  setEmbeddedMarketInteractive(false);
                  updateEmbeddedMarketState(embeddedMarketState.id, {
                    url: nextUrl,
                    title: getBrowserTitleFallback(nextUrl, fallbackTitle),
                    loading: true,
                    error: null,
                  });
                }}
                onSuggestPrompt={onSuggestPrompt}
                currentAgentName={currentAgent?.name || 'Main Agent'}
              />
            </section>
          )}

          {activeDeskView === 'browser' && (
            <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-black/10 bg-[#f9f6ec] dark:border-white/10 dark:bg-white/5">
              <div data-testid="chat-desk-browser-header" className="shrink-0 border-b border-black/10 px-3 py-2.5 dark:border-white/10">
                <div className="flex flex-col gap-2">
                  <div>
                    <p className="text-[14px] font-semibold text-foreground">{t('desk.browser.title')}</p>
                    <p className="text-[11px] text-foreground/58">{t('desk.browser.subtitle')}</p>
                  </div>
                  <div data-testid="chat-desk-browser-tabs" className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {browserTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        data-testid="chat-desk-browser-tab"
                        onClick={() => setActiveBrowserTabId(tab.id)}
                        className={cn(
                          'group flex min-w-0 max-w-[168px] items-center gap-2 rounded-[14px] border px-2.5 py-1.5 text-left transition-colors',
                          tab.id === activeBrowserTabId
                            ? 'border-black/15 bg-white text-foreground shadow-sm dark:border-white/15 dark:bg-black/10'
                            : 'border-transparent bg-transparent text-foreground/65 hover:border-black/10 hover:bg-white/60 dark:hover:border-white/10 dark:hover:bg-black/10',
                        )}
                      >
                        {tab.loading ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <Globe className="h-3 w-3 shrink-0 text-foreground/50" />
                        )}
                        <span className="truncate text-[11px] font-medium">
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
                            <X className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    ))}

                    <button
                      type="button"
                      data-testid="chat-desk-browser-new-tab"
                      onClick={handleCreateBrowserTab}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border border-black/10 bg-white/70 text-foreground/65 transition-colors hover:bg-white dark:border-white/10 dark:bg-black/10 dark:hover:bg-black/20"
                      aria-label={t('desk.browser.newTab')}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-b border-black/10 px-3 py-2 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => browserWebviewsRef.current[activeBrowserTab?.id || '']?.goBack()}
                    disabled={!activeBrowserState.canGoBack}
                    className="h-7 rounded-[12px] border-black/10 bg-white/80 px-2.5 text-[11px] dark:border-white/10 dark:bg-white/5"
                  >
                    {t('desk.browser.back')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => browserWebviewsRef.current[activeBrowserTab?.id || '']?.goForward()}
                    disabled={!activeBrowserState.canGoForward}
                    className="h-7 rounded-[12px] border-black/10 bg-white/80 px-2.5 text-[11px] dark:border-white/10 dark:bg-white/5"
                  >
                    {t('desk.browser.forward')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => browserWebviewsRef.current[activeBrowserTab?.id || '']?.reload()}
                    className="h-7 rounded-[12px] border-black/10 bg-white/80 px-2.5 text-[11px] dark:border-white/10 dark:bg-white/5"
                  >
                    <RefreshCw className={cn('mr-1.5 h-3 w-3', activeBrowserState.loading && 'animate-spin')} />
                    {t('desk.browser.reload')}
                  </Button>

                  <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-[18px] border border-black/10 bg-white/80 p-1.5 dark:border-white/10 dark:bg-black/10">
                    <Globe className="ml-1 h-3.5 w-3.5 shrink-0 text-foreground/55" />
                    <Input
                      data-testid="chat-desk-browser-url"
                      value={browserInput}
                      onChange={(event) => setBrowserInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          handleBrowserNavigate();
                        }
                      }}
                      className="h-8 border-0 bg-transparent text-[12px] shadow-none focus-visible:ring-0"
                    />
                    <Button onClick={handleBrowserNavigate} className="h-8 rounded-[12px] px-3 text-[11px]">
                      <Search className="mr-1.5 h-3 w-3" />
                      {t('desk.browser.go')}
                    </Button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {QUICK_BROWSER_LINKS.map((link) => (
                    <button
                      key={link.id}
                      type="button"
                      data-testid={`chat-desk-browser-link-${link.id}`}
                      onClick={() => navigateBrowserTo(link.url, link.label)}
                      className="rounded-[12px] border border-black/10 bg-white/80 px-2.5 py-1.5 text-[11px] font-medium text-foreground/75 transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              </div>

              <div
                ref={browserSurfaceRef}
                data-testid="chat-desk-browser-surface"
                className="relative min-h-0 flex-1 overflow-hidden bg-white/80 dark:bg-black/10"
              >
                {activeBrowserTab && (
                  <BrowserWebviewPane
                    key={activeBrowserTab.id}
                    tab={activeBrowserTab}
                    active
                    interactive={browserInteractive}
                    fallbackTitle={t('desk.browser.title')}
                    onStateChange={updateBrowserTab}
                    onRegisterWebview={registerBrowserWebview}
                  />
                )}
                {!activeBrowserTab?.error && !browserInteractive && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-gradient-to-b from-[#f9f6ec]/12 via-transparent to-[#f9f6ec]/26 p-5 dark:from-black/5 dark:to-black/30">
                    <button
                      type="button"
                      data-testid="chat-desk-browser-activate"
                      onClick={() => setBrowserInteractive(true)}
                      className="max-w-sm rounded-[20px] border border-black/10 bg-white/92 px-4 py-3.5 text-center shadow-lg transition-transform hover:-translate-y-0.5 dark:border-white/10 dark:bg-card/92"
                    >
                      <p className="text-[13px] font-semibold text-foreground">
                        {t('desk.browser.activate')}
                      </p>
                      <p className="mt-2 text-[11px] leading-6 text-foreground/65">
                        {t('desk.browser.activateBody')}
                      </p>
                    </button>
                  </div>
                )}
                {activeBrowserTab?.error && (
                  <div
                    data-testid="chat-desk-browser-error"
                    className="absolute inset-0 z-10 flex items-center justify-center bg-[#f9f6ec]/96 p-5 dark:bg-black/90"
                  >
                    <div className="w-full max-w-md rounded-[20px] border border-black/10 bg-white/90 p-[18px] shadow-xl dark:border-white/10 dark:bg-card">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-full bg-destructive/10 p-2 text-destructive">
                          <AlertCircle className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-foreground">
                            {t('desk.browser.loadFailedTitle')}
                          </p>
                          <p className="mt-1 text-[12px] leading-6 text-foreground/70">
                            {t('desk.browser.loadFailedBody')}
                          </p>
                          <p className="mt-3 break-all rounded-[16px] border border-black/10 bg-black/[0.03] px-3 py-2 font-mono text-[11px] text-foreground/70 dark:border-white/10 dark:bg-white/[0.04]">
                            {activeBrowserTab.error.url}
                          </p>
                          <p className="mt-2 text-[11px] text-foreground/55">
                            {activeBrowserTab.error.description}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button
                          className="h-8 rounded-[12px] px-3 text-[11px]"
                          onClick={() => {
                            if (!activeBrowserTab) return;
                            updateBrowserTab(activeBrowserTab.id, { loading: true, error: null });
                            const webview = browserWebviewsRef.current[activeBrowserTab.id];
                            if (webview) {
                              webview.reload();
                            }
                          }}
                        >
                          <RefreshCw className="mr-1.5 h-3 w-3" />
                          {t('desk.browser.retry')}
                        </Button>
                        <Button
                          variant="outline"
                          className="h-8 rounded-[12px] px-3 text-[11px]"
                          onClick={() => {
                            const targetUrl = activeBrowserTab.error?.url || activeBrowserTab.url;
                            void handleOpenExternalUrl(targetUrl);
                          }}
                        >
                          <ExternalLink className="mr-1.5 h-3 w-3" />
                          {t('desk.browser.openExternal')}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
