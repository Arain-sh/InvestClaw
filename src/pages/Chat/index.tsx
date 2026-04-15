/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, Loader2, Sparkles } from 'lucide-react';
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

export function Chat() {
  const { t } = useTranslation('chat');
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
  const [workspaceWidth, setWorkspaceWidth] = useState<number>(520);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const [isResizingWorkspace, setIsResizingWorkspace] = useState(false);
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef } = useStickToBottomInstant(currentSessionKey);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingWorkspaceWidthRef = useRef<number | null>(null);
  const currentAgentName = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId)?.name ?? currentAgentId,
    [agents, currentAgentId],
  );
  const setSuggestedPromptFromQuickAction = useCallback((prompt: string) => {
    setSuggestedPrompt(prompt);
    setSuggestedPromptNonce((value) => value + 1);
  }, []);
  const toggleWorkspace = useCallback(() => {
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
      const minLeftWidth = Math.min(420, Math.max(320, rect.width * 0.35));
      const minRightWidth = Math.min(520, Math.max(360, rect.width * 0.32));
      const maxRightWidth = Math.max(minRightWidth, rect.width - minLeftWidth);
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
  }, [isResizingWorkspace, scheduleWorkspaceWidthUpdate]);

  useEffect(() => {
    const clampWorkspaceWidth = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const minLeftWidth = Math.min(420, Math.max(320, rect.width * 0.35));
      const minRightWidth = Math.min(520, Math.max(360, rect.width * 0.32));
      const maxRightWidth = Math.max(minRightWidth, rect.width - minLeftWidth);
      setWorkspaceWidth((current) => Math.max(minRightWidth, Math.min(maxRightWidth, current)));
    };

    clampWorkspaceWidth();
    window.addEventListener('resize', clampWorkspaceWidth);
    return () => {
      window.removeEventListener('resize', clampWorkspaceWidth);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
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
        'relative -m-4 flex h-full min-h-0 gap-3 overflow-hidden transition-colors duration-500 md:-m-5 md:gap-4 dark:bg-background',
        isResizingWorkspace && 'select-none',
      )}
    >
      <section className="surface-panel relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-black/6 dark:border-white/10">
        <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-5 pt-5 md:px-6">
          <div className="hidden min-w-0 items-center gap-2 rounded-full border border-black/6 bg-white/70 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground md:flex">
            <span>{t('welcome.title')}</span>
          </div>
          <div className="ml-auto">
            <ChatToolbar workspaceVisible={!workspaceCollapsed} onToggleWorkspace={toggleWorkspace} />
          </div>
        </div>

        {isLanding ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-5 pb-8 pt-12 md:px-8 md:pt-14">
            <WelcomeScreen onSelectPrompt={setSuggestedPromptFromQuickAction}>
              <ChatInput
                onSend={sendMessage}
                onStop={abortRun}
                disabled={!isGatewayRunning}
                sending={sending}
                isEmpty={isEmpty}
                presetPrompt={suggestedPrompt}
                presetPromptNonce={suggestedPromptNonce}
                layout="hero"
              />
            </WelcomeScreen>
          </div>
        ) : (
          <>
            {/* Messages Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-4 pt-16 md:px-6">
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

            <div className="shrink-0 px-5 pb-5 md:px-6">
              <ChatInput
                onSend={sendMessage}
                onStop={abortRun}
                disabled={!isGatewayRunning}
                sending={sending}
                isEmpty={isEmpty}
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
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-xl bg-background/20 backdrop-blur-[1px] pointer-events-auto">
            <div className="rounded-full border border-border bg-background p-2.5 shadow-lg">
              <LoadingSpinner size="md" />
            </div>
          </div>
        )}
      </section>

      {!workspaceCollapsed && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            data-testid="chat-workspace-resizer"
            className="group relative hidden w-3 shrink-0 cursor-col-resize bg-transparent lg:block"
            onPointerDown={() => {
              setIsResizingWorkspace(true);
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          >
            <div className={cn(
              'absolute inset-y-4 left-1/2 w-px -translate-x-1/2 rounded-full bg-black/10 transition-colors dark:bg-white/10',
              isResizingWorkspace && 'bg-primary/60',
            )} />
          </div>

          <aside className="hidden shrink-0 overflow-hidden pb-1 pr-1 pt-1 lg:block" style={{ width: `${workspaceWidth}px` }}>
            <WorkspacePanel
              agentId={currentAgentId}
              agentName={currentAgentName}
            />
          </aside>
        </>
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
  const quickActions = [
    { key: 'askQuestions', label: t('welcome.askQuestions'), prompt: t('welcome.askQuestionsPrompt') },
    { key: 'creativeTasks', label: t('welcome.creativeTasks'), prompt: t('welcome.creativeTasksPrompt') },
    { key: 'brainstorming', label: t('welcome.brainstorming'), prompt: t('welcome.brainstormingPrompt') },
  ];

  return (
    <div data-testid="chat-landing-hero" className="pointer-events-none mx-auto flex w-full max-w-4xl flex-col items-center text-center">
      <div className="pointer-events-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[1.6rem] border border-black/8 bg-white/80 shadow-[0_1px_0_rgba(255,255,255,0.85)_inset,0_18px_36px_rgba(24,18,12,0.06)]">
        <img src={logoSvg} alt="InvestClaw" className="h-8 w-auto" />
      </div>

      <div className="pointer-events-auto mb-4 inline-flex items-center rounded-full border border-black/6 bg-white/75 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {t('welcome.title')}
      </div>

      <h1 className="font-display max-w-3xl text-[2.7rem] font-medium leading-[1.05] tracking-[-0.045em] text-foreground md:text-[4.2rem]">
        {t('welcome.subtitle')}
      </h1>

      <p className="pointer-events-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-[15px]">
        {t('welcome.caption')}
      </p>

      <div className="pointer-events-auto mt-8 w-full">
        {children}
      </div>

      <div className="pointer-events-auto mt-6 flex max-w-3xl w-full flex-wrap items-center justify-center gap-3">
        {quickActions.map(({ key, label, prompt }) => (
          <button
            key={key}
            type="button"
            onClick={() => onSelectPrompt(prompt)}
            data-testid={`chat-quick-action-${key}`}
            className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white/72 px-4 py-2 text-[13px] font-medium text-foreground/72 shadow-[0_1px_0_rgba(255,255,255,0.85)_inset] transition-colors hover:bg-white"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#d39c2d]" />
            {label}
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/70" />
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
