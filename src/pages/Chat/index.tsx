/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, BarChart3, FileSearch, Lightbulb, Loader2, Sparkles } from 'lucide-react';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';
import { WorkspacePanel } from './WorkspacePanel';
import logoSvg from '@/assets/logo.svg';
import { useShallow } from 'zustand/react/shallow';

const WORKSPACE_OVERLAY_BREAKPOINT = 760;

export function Chat() {
  const { t } = useTranslation('chat');
  const initialViewportWidth = typeof window === 'undefined' ? 1600 : window.innerWidth;
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const {
    messages,
    currentSessionKey,
    loading,
    sending,
    error,
    showThinking,
    streamingMessage,
    streamingTools,
    pendingFinal,
    currentAgentId,
    sendMessage,
    abortRun,
    clearError,
    cleanupEmptySession,
  } = useChatStore(useShallow((s) => ({
    messages: s.messages,
    currentSessionKey: s.currentSessionKey,
    loading: s.loading,
    sending: s.sending,
    error: s.error,
    showThinking: s.showThinking,
    streamingMessage: s.streamingMessage,
    streamingTools: s.streamingTools,
    pendingFinal: s.pendingFinal,
    currentAgentId: s.currentAgentId,
    sendMessage: s.sendMessage,
    abortRun: s.abortRun,
    clearError: s.clearError,
    cleanupEmptySession: s.cleanupEmptySession,
  })));
  const { agents, fetchAgents } = useAgentsStore(useShallow((s) => ({
    agents: s.agents,
    fetchAgents: s.fetchAgents,
  })));

  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const [suggestedPrompt, setSuggestedPrompt] = useState<string>('');
  const [suggestedPromptNonce, setSuggestedPromptNonce] = useState<number>(0);
  const [workspaceWidth, setWorkspaceWidth] = useState<number>(460);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(
    initialViewportWidth < WORKSPACE_OVERLAY_BREAKPOINT,
  );
  const [isResizingWorkspace, setIsResizingWorkspace] = useState(false);
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef } = useStickToBottomInstant(currentSessionKey);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const layoutFrameRef = useRef<number | null>(null);
  const pendingWorkspaceWidthRef = useRef<number | null>(null);
  const hasManualWorkspaceResizeRef = useRef(false);
  const hasManualWorkspaceToggleRef = useRef(false);
  const [workspaceDisplayMode, setWorkspaceDisplayMode] = useState<'docked' | 'overlay'>(
    initialViewportWidth < WORKSPACE_OVERLAY_BREAKPOINT ? 'overlay' : 'docked',
  );
  const currentAgentName = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId)?.name ?? currentAgentId,
    [agents, currentAgentId],
  );
  const setSuggestedPromptFromQuickAction = useCallback((prompt: string) => {
    setSuggestedPrompt(prompt);
    setSuggestedPromptNonce((value) => value + 1);
  }, []);
  const toggleWorkspace = useCallback(() => {
    hasManualWorkspaceToggleRef.current = true;
    setWorkspaceCollapsed((current) => !current);
  }, []);

  const scheduleWorkspaceWidthUpdate = useCallback((nextWidth: number) => {
    pendingWorkspaceWidthRef.current = nextWidth;
    if (resizeFrameRef.current != null) {
      return;
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const pendingWidth = pendingWorkspaceWidthRef.current;
      if (typeof pendingWidth !== 'number') return;
      setWorkspaceWidth((current) => (current === pendingWidth ? current : pendingWidth));
    });
  }, []);

  const getWorkspaceSizing = useCallback((containerWidth: number) => {
    const isCompactLayout = containerWidth < 980;
    const minMainWidth = isCompactLayout
      ? Math.min(520, Math.max(320, containerWidth * 0.32))
      : Math.min(640, Math.max(360, containerWidth * 0.3));
    const minRightWidth = isCompactLayout
      ? Math.min(360, Math.max(280, containerWidth * 0.26))
      : Math.min(420, Math.max(320, containerWidth * 0.24));
    const maxRightWidth = Math.max(minRightWidth, containerWidth - minMainWidth);
    const preferredRightWidth = Math.max(
      minRightWidth,
      Math.min(maxRightWidth, Math.round(containerWidth * (isCompactLayout ? 0.34 : 0.32))),
    );

    return {
      minRightWidth,
      maxRightWidth,
      preferredRightWidth,
    };
  }, []);
  const showDockedWorkspace = !workspaceCollapsed && workspaceDisplayMode === 'docked';
  const showOverlayWorkspace = !workspaceCollapsed && workspaceDisplayMode === 'overlay';

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

  useEffect(() => {
    if (!isResizingWorkspace) return;

    const handlePointerMove = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const { minRightWidth, maxRightWidth } = getWorkspaceSizing(rect.width);
      const nextWidth = rect.right - event.clientX;
      scheduleWorkspaceWidthUpdate(Math.max(minRightWidth, Math.min(maxRightWidth, nextWidth)));
    };

    const stopResizing = () => {
      setIsResizingWorkspace(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', stopResizing, { once: true });

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [getWorkspaceSizing, isResizingWorkspace, scheduleWorkspaceWidthUpdate]);

  useEffect(() => {
    const syncWorkspaceLayout = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const nextDisplayMode = rect.width < WORKSPACE_OVERLAY_BREAKPOINT ? 'overlay' : 'docked';
      const { minRightWidth, maxRightWidth, preferredRightWidth } = getWorkspaceSizing(rect.width);

      setWorkspaceDisplayMode((current) => (current === nextDisplayMode ? current : nextDisplayMode));
      if (!hasManualWorkspaceToggleRef.current) {
        setWorkspaceCollapsed(nextDisplayMode === 'overlay');
      }
      setWorkspaceWidth((current) => {
        const nextWidth = hasManualWorkspaceResizeRef.current
          ? Math.max(minRightWidth, Math.min(maxRightWidth, current))
          : preferredRightWidth;
        return Math.abs(nextWidth - current) < 1 ? current : nextWidth;
      });
    };

    const scheduleLayoutSync = () => {
      if (layoutFrameRef.current != null) {
        return;
      }

      layoutFrameRef.current = window.requestAnimationFrame(() => {
        layoutFrameRef.current = null;
        syncWorkspaceLayout();
      });
    };

    scheduleLayoutSync();

    const observer = new ResizeObserver(() => {
      scheduleLayoutSync();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    window.addEventListener('resize', scheduleLayoutSync);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleLayoutSync);
      if (layoutFrameRef.current != null) {
        window.cancelAnimationFrame(layoutFrameRef.current);
      }
    };
  }, [getWorkspaceSizing]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      if (layoutFrameRef.current != null) {
        window.cancelAnimationFrame(layoutFrameRef.current);
      }
    };
  }, []);

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
  const isLanding = isEmpty && !sending;

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex h-full min-h-0 gap-0 overflow-hidden p-3 transition-colors duration-300 md:p-4 dark:bg-background',
        isResizingWorkspace && 'select-none',
      )}
    >
      <section
        data-testid="chat-main-panel"
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[1.7rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.5),rgba(248,251,255,0.76))]"
      >
        <div className="absolute inset-x-0 top-0 z-40 flex items-start justify-end px-4 pt-4 md:px-5 md:pt-5">
          <div className="ml-auto">
            <ChatToolbar
              workspaceVisible={!workspaceCollapsed}
              onToggleWorkspace={toggleWorkspace}
              hideUtilityToggles={showOverlayWorkspace}
            />
          </div>
        </div>

        {isLanding ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-8 pt-16 md:px-6 md:pb-10 md:pt-20 xl:px-10">
            <WelcomeScreen onSelectPrompt={setSuggestedPromptFromQuickAction}>
              <ChatInput
                key={`hero-${currentSessionKey}`}
                onSend={sendMessage}
                onStop={abortRun}
                disabled={!isGatewayRunning}
                sending={sending}
                isEmpty={isEmpty}
                sessionKey={currentSessionKey}
                presetPrompt={suggestedPrompt}
                presetPromptNonce={suggestedPromptNonce}
                layout="hero"
              />
            </WelcomeScreen>
          </div>
        ) : (
          <>
            {/* Messages Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-4 pt-16 md:px-6">
              <div ref={contentRef} className="mx-auto max-w-4xl space-y-5 pb-8">
                {messages.map((msg, idx) => (
                  <ChatMessage
                    key={msg.id || `msg-${idx}`}
                    message={msg}
                    showThinking={showThinking}
                  />
                ))}

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

                {sending && pendingFinal && !shouldRenderStreaming && (
                  <ActivityIndicator phase="tool_processing" />
                )}

                {sending && !pendingFinal && !hasAnyStreamContent && (
                  <TypingIndicator />
                )}
              </div>
            </div>

            <div className="shrink-0 px-4 pb-4 md:px-6 md:pb-5">
              <ChatInput
                key={`dock-${currentSessionKey}`}
                onSend={sendMessage}
                onStop={abortRun}
                disabled={!isGatewayRunning}
                sending={sending}
                isEmpty={isEmpty}
                sessionKey={currentSessionKey}
                presetPrompt={suggestedPrompt}
                presetPromptNonce={suggestedPromptNonce}
              />
            </div>
          </>
        )}

        {error && (
          <div className="border-t border-destructive/20 bg-destructive/10 px-5 py-2 md:px-6">
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

        {minLoading && !sending && (
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-xl bg-background/14 pointer-events-auto">
            <div className="rounded-full border border-slate-300/45 bg-white/78 p-2.5 shadow-[0_12px_28px_rgba(15,23,42,0.08)] backdrop-blur-md">
              <LoadingSpinner size="md" />
            </div>
          </div>
        )}
      </section>

      {showDockedWorkspace && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            data-testid="chat-workspace-resizer"
            className="group relative w-3 shrink-0 cursor-col-resize bg-transparent"
            onPointerDown={() => {
              hasManualWorkspaceResizeRef.current = true;
              setIsResizingWorkspace(true);
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          >
            <div className={cn(
              'absolute inset-y-4 left-1/2 w-px -translate-x-1/2 rounded-full bg-slate-300/70 transition-colors dark:bg-white/10',
              isResizingWorkspace && 'bg-primary/60',
            )} />
          </div>

          <aside className="shrink-0 overflow-hidden pb-1 pr-1 pt-1" style={{ width: `${workspaceWidth}px` }}>
            <WorkspacePanel
              agentId={currentAgentId}
              agentName={currentAgentName}
            />
          </aside>
        </>
      )}

      {showOverlayWorkspace && (
        <div className="pointer-events-none absolute inset-0 z-30">
          <button
            type="button"
            aria-label={t('workspace.collapse')}
            data-testid="workspace-overlay-backdrop"
            className="pointer-events-auto absolute inset-0 bg-transparent"
            onClick={() => setWorkspaceCollapsed(true)}
          />
          <div className="pointer-events-auto absolute inset-y-0 right-0 flex w-full max-w-[min(31rem,calc(100%-0.75rem))] min-w-[18.5rem] overflow-hidden p-1 md:p-1.5">
            <WorkspacePanel
              agentId={currentAgentId}
              agentName={currentAgentName}
              onRequestClose={() => setWorkspaceCollapsed(true)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

const WelcomeScreen = memo(function WelcomeScreen({
  onSelectPrompt,
  children,
}: {
  onSelectPrompt: (prompt: string) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('chat');
  const currentHour = new Date().getHours();
  const greetingKey = currentHour < 12 ? 'morning' : currentHour < 18 ? 'afternoon' : 'evening';
  const quickActions = [
    { key: 'askQuestions', label: t('welcome.askQuestions'), prompt: t('welcome.askQuestionsPrompt'), icon: BarChart3 },
    { key: 'creativeTasks', label: t('welcome.creativeTasks'), prompt: t('welcome.creativeTasksPrompt'), icon: FileSearch },
    { key: 'brainstorming', label: t('welcome.brainstorming'), prompt: t('welcome.brainstormingPrompt'), icon: Lightbulb },
  ];

  return (
    <div data-testid="chat-landing-hero" className="pointer-events-none mx-auto flex w-full max-w-[58rem] flex-col items-center text-center">
      <div className="pointer-events-auto mb-7 flex items-center justify-center gap-4 md:mb-9 md:gap-4.5">
        <img src={logoSvg} alt="AraInvest" className="h-[2.35rem] w-auto opacity-95 md:h-[2.6rem]" />
        <h1 className="text-balance font-display text-[clamp(3.2rem,4.6vw,4.95rem)] font-semibold leading-[0.96] tracking-[-0.065em] text-foreground/90">
          {t(`welcome.greeting.${greetingKey}`)}
        </h1>
      </div>

      <div className="pointer-events-auto w-full">
        {children}
      </div>

      <div className="pointer-events-auto mt-5 flex w-full max-w-[52rem] flex-wrap items-center justify-center gap-2.5 md:mt-6 md:gap-3">
        {quickActions.map(({ key, label, prompt, icon: ActionIcon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onSelectPrompt(prompt)}
            data-testid={`chat-quick-action-${key}`}
            className="inline-flex items-center gap-2.5 rounded-full border border-slate-300/55 bg-white/70 px-4 py-2 text-[13px] font-medium text-foreground/74 shadow-[0_8px_16px_rgba(15,23,42,0.032)] transition-colors hover:bg-white/84"
          >
            <ActionIcon className="h-3.5 w-3.5 text-[#d97745]" />
            {label}
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/55" />
          </button>
        ))}
      </div>
    </div>
  );
});

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
