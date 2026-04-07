/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertCircle, Loader2, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useProviderStore } from '@/stores/providers';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { ResearchDeskPanel } from './ResearchDeskPanel';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';
import { hasAvailableProvider } from '@/lib/provider-readiness';

const DEFAULT_DESK_WIDTH = 560;
const MIN_DESK_WIDTH = 320;
const MAX_DESK_WIDTH = 920;
const MIN_CHAT_COLUMN_WIDTH = 440;
const DESKTOP_BREAKPOINT = 1024;

function clampDeskWidth(width: number, layoutWidth?: number): number {
  if (typeof window === 'undefined') {
    return Math.min(Math.max(width, MIN_DESK_WIDTH), MAX_DESK_WIDTH);
  }

  const isDesktop = window.innerWidth >= DESKTOP_BREAKPOINT;
  const fallbackMax = Math.max(MIN_DESK_WIDTH, window.innerWidth - 420);
  const layoutConstrainedMax = layoutWidth
    ? Math.max(MIN_DESK_WIDTH, layoutWidth - MIN_CHAT_COLUMN_WIDTH - 12)
    : fallbackMax;
  const availableMax = isDesktop ? layoutConstrainedMax : fallbackMax;

  return Math.min(Math.max(width, MIN_DESK_WIDTH), Math.min(MAX_DESK_WIDTH, availableMax));
}

export function Chat() {
  const navigate = useNavigate();
  const { t } = useTranslation('chat');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providersInitialized = useProviderStore((s) => s.isInitialized);
  const providersLoading = useProviderStore((s) => s.loading);

  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const agents = useAgentsStore((s) => s.agents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);

  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const [suggestedPrompt, setSuggestedPrompt] = useState<string>('');
  const [suggestedPromptNonce, setSuggestedPromptNonce] = useState<number>(0);
  const [deskOpen, setDeskOpen] = useState(true);
  const [deskWidth, setDeskWidth] = useState(DEFAULT_DESK_WIDTH);
  const [layoutWidth, setLayoutWidth] = useState<number>(0);
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef } = useStickToBottomInstant(currentSessionKey);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages → spinner → messages flicker.
  useEffect(() => {
    return () => {
      // If the user navigates away without sending any messages, remove the
      // empty session so it doesn't linger as a ghost entry in the sidebar.
      cleanupEmptySession();
    };
  }, [cleanupEmptySession]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    try {
      const savedWidth = window.localStorage.getItem('investclaw:chat-desk-width');
      if (!savedWidth) return;
      const parsed = Number(savedWidth);
      if (Number.isFinite(parsed)) {
        setDeskWidth(parsed);
      }
    } catch {
      // ignore persistence issues
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('investclaw:chat-desk-width', String(deskWidth));
    } catch {
      // ignore persistence issues
    }
  }, [deskWidth]);

  useEffect(() => {
    const layoutNode = layoutRef.current;
    if (!layoutNode || typeof ResizeObserver === 'undefined') return;

    const updateWidth = () => {
      setLayoutWidth(layoutNode.getBoundingClientRect().width);
    };

    updateWidth();
    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(layoutNode);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      const nextWidth = resizeState.startWidth + (resizeState.startX - event.clientX);
      setDeskWidth(clampDeskWidth(nextWidth, layoutWidth));
    };

    const handlePointerUp = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const handleResize = () => {
      setDeskWidth((current) => clampDeskWidth(current, layoutWidth));
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('resize', handleResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [layoutWidth]);

  useEffect(() => {
    if (!layoutWidth) return;
    setDeskWidth((current) => clampDeskWidth(current, layoutWidth));
  }, [layoutWidth]);

  // Update timestamp when sending starts
  useEffect(() => {
    if (sending && streamingTimestamp === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStreamingTimestamp(Date.now() / 1000);
    } else if (!sending && streamingTimestamp !== 0) {
      setStreamingTimestamp(0);
    }
  }, [sending, streamingTimestamp]);

  // Gateway not running block has been completely removed so the UI always renders.

  const streamMsg = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number }
    : null;
  const streamText = streamMsg ? extractText(streamMsg) : (typeof streamingMessage === 'string' ? streamingMessage : '');
  const hasStreamText = streamText.trim().length > 0;
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
  const streamTools = streamMsg ? extractToolUse(streamMsg) : [];
  const hasStreamTools = streamTools.length > 0;
  const streamImages = streamMsg ? extractImages(streamMsg) : [];
  const hasStreamImages = streamImages.length > 0;
  const hasStreamToolStatus = streamingTools.length > 0;
  const shouldRenderStreaming = sending && (hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus);
  const hasAnyStreamContent = hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus;

  const isEmpty = messages.length === 0 && !sending;
  const currentAgent = agents.find((agent) => agent.id === currentAgentId) ?? null;
  const effectiveDeskWidth = clampDeskWidth(deskWidth, layoutWidth);
  const providerReady = useMemo(
    () => hasAvailableProvider(providerAccounts, providerStatuses),
    [providerAccounts, providerStatuses],
  );
  const providerMissing = isGatewayRunning && providersInitialized && !providersLoading && !providerReady;
  const composerDisabled = !isGatewayRunning || providerMissing;
  const composerDisabledPlaceholder = !isGatewayRunning
    ? t('composer.gatewayDisconnectedPlaceholder')
    : providerMissing
      ? t('composer.providerMissingPlaceholder')
      : undefined;

  const handleDeskResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!deskOpen) return;
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: effectiveDeskWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div data-testid="chat-page" className={cn("relative flex min-w-0 flex-col -m-6 transition-colors duration-500 dark:bg-background")} style={{ height: 'calc(100vh - 2.5rem)' }}>
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2">
        <div className="hidden lg:flex items-center gap-2 rounded-full border border-black/10 bg-white/65 px-3 py-1.5 text-[12px] font-medium text-foreground/75 dark:border-white/10 dark:bg-white/5">
          <span>{t('desk.inlineHint')}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="chat-desk-toggle"
            className="h-8 w-8"
            onClick={() => setDeskOpen((value) => !value)}
          >
            {deskOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
          <ChatToolbar />
        </div>
      </div>

      <div ref={layoutRef} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-4 pb-4 lg:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-black/5 bg-[#f7f4ea] shadow-[0_24px_80px_rgba(36,39,27,0.08)] dark:border-white/5 dark:bg-background">
          {/* Messages Area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            <div ref={contentRef} className="max-w-4xl mx-auto space-y-4">
              {isEmpty ? (
                <WelcomeScreen
                  onSelectPrompt={(prompt) => {
                    setSuggestedPrompt(prompt);
                    setSuggestedPromptNonce((value) => value + 1);
                  }}
                />
              ) : (
                <>
                  {messages.map((msg, idx) => (
                    <ChatMessage
                      key={msg.id || `msg-${idx}`}
                      message={msg}
                      showThinking={showThinking}
                    />
                  ))}

                  {/* Streaming message */}
                  {shouldRenderStreaming && (
                    <ChatMessage
                      message={(streamMsg
                        ? {
                            ...(streamMsg as Record<string, unknown>),
                            role: (typeof streamMsg.role === 'string' ? streamMsg.role : 'assistant') as RawMessage['role'],
                            content: streamMsg.content ?? streamText,
                            timestamp: streamMsg.timestamp ?? streamingTimestamp,
                          }
                        : {
                            role: 'assistant',
                            content: streamText,
                            timestamp: streamingTimestamp,
                          }) as RawMessage}
                      showThinking={showThinking}
                      isStreaming
                      streamingTools={streamingTools}
                    />
                  )}

                  {/* Activity indicator: waiting for next AI turn after tool execution */}
                  {sending && pendingFinal && !shouldRenderStreaming && (
                    <ActivityIndicator phase="tool_processing" />
                  )}

                  {/* Typing indicator when sending but no stream content yet */}
                  {sending && !pendingFinal && !hasAnyStreamContent && (
                    <TypingIndicator />
                  )}
                </>
              )}
            </div>
          </div>

          {/* Error bar */}
          {error && (
            <div className="border-t border-destructive/20 bg-destructive/10 px-4 py-2">
              <div className="mx-auto flex max-w-4xl items-center justify-between">
                <p className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </p>
                <button
                  onClick={clearError}
                  className="text-xs text-destructive/60 hover:text-destructive underline"
                >
                  {t('common:actions.dismiss')}
                </button>
              </div>
            </div>
          )}

          {providerMissing && (
            <div className="border-t border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <p
                    data-testid="chat-provider-required"
                    className="text-sm font-medium text-amber-900 dark:text-amber-100"
                  >
                    {t('providerRequired.title')}
                  </p>
                  <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
                    {t('providerRequired.body')}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  data-testid="chat-provider-required-cta"
                  className="shrink-0"
                  onClick={() => navigate('/models')}
                >
                  {t('providerRequired.cta')}
                </Button>
              </div>
            </div>
          )}

          {/* Input Area */}
          <ChatInput
            onSend={sendMessage}
            onStop={abortRun}
            disabled={composerDisabled}
            disabledPlaceholder={composerDisabledPlaceholder}
            sending={sending}
            isEmpty={isEmpty}
            presetPrompt={suggestedPrompt}
            presetPromptNonce={suggestedPromptNonce}
          />

          {/* Transparent loading overlay */}
          {minLoading && !sending && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/20 backdrop-blur-[1px] rounded-xl pointer-events-auto">
              <div className="bg-background shadow-lg rounded-full p-2.5 border border-border">
                <LoadingSpinner size="md" />
              </div>
            </div>
          )}
        </div>

        {deskOpen && (
          <>
            <div
              data-testid="chat-desk-resizer"
              role="separator"
              aria-orientation="vertical"
              onPointerDown={handleDeskResizeStart}
              className="hidden w-3 shrink-0 cursor-col-resize items-stretch justify-center lg:flex"
            >
              <div className="my-4 w-px rounded-full bg-black/10 dark:bg-white/10" />
            </div>
            <div
              data-testid="chat-desk-container"
              className="min-h-0 w-full shrink-0 lg:w-auto lg:max-w-[80vw]"
              style={{ '--chat-desk-width': `${effectiveDeskWidth}px` } as CSSProperties}
            >
              <div className="h-full w-full lg:w-[var(--chat-desk-width)]">
                <ResearchDeskPanel
                  currentAgent={currentAgent}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

function WelcomeScreen({ onSelectPrompt }: { onSelectPrompt: (prompt: string) => void }) {
  const { t } = useTranslation('chat');
  const quickActions = [
    { key: 'askQuestions', label: t('welcome.askQuestions'), prompt: t('welcome.askQuestionsPrompt') },
    { key: 'creativeTasks', label: t('welcome.creativeTasks'), prompt: t('welcome.creativeTasksPrompt') },
    { key: 'brainstorming', label: t('welcome.brainstorming'), prompt: t('welcome.brainstormingPrompt') },
  ];

  return (
    <div className="flex flex-col items-center justify-center text-center h-[60vh]">
      <h1 className="text-4xl md:text-5xl font-serif text-foreground/80 mb-8 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
        {t('welcome.subtitle')}
      </h1>

      <div className="flex flex-wrap items-center justify-center gap-2.5 max-w-lg w-full">
        {quickActions.map(({ key, label, prompt }) => (
          <button
            key={key}
            type="button"
            onClick={() => onSelectPrompt(prompt)}
            data-testid={`chat-quick-action-${key}`}
            className="px-4 py-1.5 rounded-full border border-black/10 dark:border-white/10 text-[13px] font-medium text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5 transition-colors bg-black/[0.02]"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

// ── Activity Indicator (shown between tool cycles) ─────────────

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  void phase;
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Processing tool results…</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
