/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Network,
  Bot,
  Puzzle,
  Clock,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Terminal,
  ExternalLink,
  Trash2,
  Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApiFetch } from '@/lib/host-api';
import { useTranslation } from 'react-i18next';
import logoSvg from '@/assets/logo.svg';
import { useShallow } from 'zustand/react/shallow';

type SessionBucketKey =
  | 'today'
  | 'yesterday'
  | 'withinWeek'
  | 'withinTwoWeeks'
  | 'withinMonth'
  | 'older';

interface NavItemProps {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: string;
  collapsed?: boolean;
  onClick?: () => void;
  testId?: string;
}

function NavItem({ to, icon, label, badge, collapsed, onClick, testId }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      data-testid={testId}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[14px] font-medium transition-colors',
          'hover:bg-black/[0.035] dark:hover:bg-white/5 text-foreground/75',
          isActive
            ? 'bg-white/75 text-foreground shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_12px_28px_rgba(24,18,12,0.05)]'
            : '',
          collapsed && 'justify-center px-0'
        )
      }
    >
      {({ isActive }) => (
        <>
          <div className={cn("flex shrink-0 items-center justify-center", isActive ? "text-foreground" : "text-muted-foreground")}>
            {icon}
          </div>
          {!collapsed && (
            <>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
              {badge && (
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {badge}
                </Badge>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}

function getSessionBucket(activityMs: number, nowMs: number): SessionBucketKey {
  if (!activityMs || activityMs <= 0) return 'older';

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  if (activityMs >= startOfToday) return 'today';
  if (activityMs >= startOfYesterday) return 'yesterday';

  const daysAgo = (startOfToday - activityMs) / (24 * 60 * 60 * 1000);
  if (daysAgo <= 7) return 'withinWeek';
  if (daysAgo <= 14) return 'withinTwoWeeks';
  if (daysAgo <= 30) return 'withinMonth';
  return 'older';
}

const INITIAL_NOW_MS = Date.now();

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);

  const {
    sessions,
    currentSessionKey,
    sessionLabels,
    sessionLastActivity,
    switchSession,
    newSession,
    deleteSession,
    loadSessions,
    loadHistory,
  } = useChatStore(useShallow((s) => ({
    sessions: s.sessions,
    currentSessionKey: s.currentSessionKey,
    sessionLabels: s.sessionLabels,
    sessionLastActivity: s.sessionLastActivity,
    switchSession: s.switchSession,
    newSession: s.newSession,
    deleteSession: s.deleteSession,
    loadSessions: s.loadSessions,
    loadHistory: s.loadHistory,
  })));

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    const hasExistingMessages = useChatStore.getState().messages.length > 0;
    (async () => {
      await loadSessions();
      if (cancelled) return;
      await loadHistory(hasExistingMessages);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGatewayRunning, loadHistory, loadSessions]);
  const { agents, fetchAgents } = useAgentsStore(useShallow((s) => ({
    agents: s.agents,
    fetchAgents: s.fetchAgents,
  })));

  const navigate = useNavigate();
  const isOnChat = useLocation().pathname === '/';

  const getSessionLabel = (key: string, displayName?: string, label?: string) =>
    sessionLabels[key] ?? label ?? displayName ?? key;

  const openDevConsole = async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        error?: string;
      }>('/api/gateway/control-ui');
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  const { t } = useTranslation(['common', 'chat']);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [nowMs, setNowMs] = useState(INITIAL_NOW_MS);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const agentNameById = useMemo(
    () => Object.fromEntries((agents ?? []).map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const sessionBuckets: Array<{ key: SessionBucketKey; label: string; sessions: typeof sessions }> = [
    { key: 'today', label: t('chat:historyBuckets.today'), sessions: [] },
    { key: 'yesterday', label: t('chat:historyBuckets.yesterday'), sessions: [] },
    { key: 'withinWeek', label: t('chat:historyBuckets.withinWeek'), sessions: [] },
    { key: 'withinTwoWeeks', label: t('chat:historyBuckets.withinTwoWeeks'), sessions: [] },
    { key: 'withinMonth', label: t('chat:historyBuckets.withinMonth'), sessions: [] },
    { key: 'older', label: t('chat:historyBuckets.older'), sessions: [] },
  ];
  const sessionBucketMap = Object.fromEntries(sessionBuckets.map((bucket) => [bucket.key, bucket])) as Record<
    SessionBucketKey,
    (typeof sessionBuckets)[number]
  >;

  for (const session of [...sessions].sort((a, b) =>
    (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0)
  )) {
    const bucketKey = getSessionBucket(sessionLastActivity[session.key] ?? 0, nowMs);
    sessionBucketMap[bucketKey].sessions.push(session);
  }

  const navItems = [
    { to: '/models', icon: <Cpu className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.models'), testId: 'sidebar-nav-models' },
    { to: '/agents', icon: <Bot className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.agents'), testId: 'sidebar-nav-agents' },
    { to: '/channels', icon: <Network className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.channels'), testId: 'sidebar-nav-channels' },
    { to: '/skills', icon: <Puzzle className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.skills'), testId: 'sidebar-nav-skills' },
    { to: '/cron', icon: <Clock className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.cronTasks'), testId: 'sidebar-nav-cron' },
  ];

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'flex shrink-0 flex-col rounded-[1.9rem] border border-black/5 bg-[#f7f2e9]/90 shadow-[0_18px_34px_rgba(34,24,10,0.045)] transition-all duration-300 dark:bg-background/95',
        sidebarCollapsed ? 'w-[4.75rem]' : 'w-[17.5rem]'
      )}
    >
      {/* Top Header Toggle */}
      <div className={cn("flex items-center px-3 pb-2 pt-4", sidebarCollapsed ? "justify-center" : "justify-between")}>
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2.5 px-2 overflow-hidden">
            <img src={logoSvg} alt="InvestClaw" className="h-6 w-auto shrink-0" />
            <span className="font-display truncate whitespace-nowrap text-[1.15rem] font-medium tracking-[-0.03em] text-foreground/90">
              InvestClaw
            </span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="h-[18px] w-[18px]" />
          ) : (
            <PanelLeftClose className="h-[18px] w-[18px]" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-3">
        <button
          data-testid="sidebar-new-chat"
          onClick={() => {
            const { messages } = useChatStore.getState();
            if (messages.length > 0) newSession();
            navigate('/');
          }}
          className={cn(
            'mb-3 flex w-full items-center gap-3 rounded-[1.35rem] border border-black/6 bg-white/80 px-3 py-3 text-[14px] font-medium text-foreground shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_16px_30px_rgba(24,18,12,0.04)] transition-colors',
            'hover:bg-white',
            sidebarCollapsed && 'justify-center px-0',
          )}
        >
          <div className="flex shrink-0 items-center justify-center text-foreground/80">
            <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          {!sidebarCollapsed && <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.newChat')}</span>}
        </button>

        {navItems.map((item) => (
          <NavItem
            key={item.to}
            {...item}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>

      {/* Session list — below Settings, only when expanded */}
      {!sidebarCollapsed && sessions.length > 0 && (
        <div className="mt-4 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3 pb-3 [content-visibility:auto]">
          {sessionBuckets.map((bucket) => (
            bucket.sessions.length > 0 ? (
              <SessionBucketSection
                key={bucket.key}
                label={bucket.label}
                sessions={bucket.sessions}
                currentSessionKey={currentSessionKey}
                isOnChat={isOnChat}
                getAgentName={(sessionKey) => {
                  const agentId = getAgentIdFromSessionKey(sessionKey);
                  return agentNameById[agentId] || agentId;
                }}
                getSessionLabel={getSessionLabel}
                onSelectSession={(key) => {
                  switchSession(key);
                  navigate('/');
                }}
                onDeleteSession={(key, label) => {
                  setSessionToDelete({ key, label });
                }}
              />
            ) : null
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto px-3 pb-3 pt-2">
        <NavLink
            to="/settings"
            data-testid="sidebar-nav-settings"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[14px] font-medium transition-colors',
                'hover:bg-black/[0.035] dark:hover:bg-white/5 text-foreground/80',
                isActive && 'bg-white/75 text-foreground shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_12px_28px_rgba(24,18,12,0.05)]',
                sidebarCollapsed ? 'justify-center px-0' : ''
              )
            }
          >
          {({ isActive }) => (
            <>
              <div className={cn("flex shrink-0 items-center justify-center", isActive ? "text-foreground" : "text-muted-foreground")}>
                <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={2} />
              </div>
              {!sidebarCollapsed && <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.settings')}</span>}
            </>
          )}
        </NavLink>

        <Button
          data-testid="sidebar-open-dev-console"
          variant="ghost"
          className={cn(
            'mt-1 flex h-auto w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-[14px] font-medium transition-colors',
            'hover:bg-black/[0.035] dark:hover:bg-white/5 text-foreground/80',
            sidebarCollapsed ? 'justify-center px-0' : 'justify-start'
          )}
          onClick={openDevConsole}
        >
          <div className="flex shrink-0 items-center justify-center text-muted-foreground">
            <Terminal className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          {!sidebarCollapsed && (
            <>
              <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('common:sidebar.openClawPage')}</span>
              <ExternalLink className="h-3 w-3 shrink-0 ml-auto opacity-50 text-muted-foreground" />
            </>
          )}
        </Button>
      </div>

      <ConfirmDialog
        open={!!sessionToDelete}
        title={t('common:actions.confirm')}
        message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!sessionToDelete) return;
          await deleteSession(sessionToDelete.key);
          if (currentSessionKey === sessionToDelete.key) navigate('/');
          setSessionToDelete(null);
        }}
        onCancel={() => setSessionToDelete(null)}
      />
    </aside>
  );
}

const SessionBucketSection = memo(function SessionBucketSection({
  label,
  sessions,
  currentSessionKey,
  isOnChat,
  getAgentName,
  getSessionLabel,
  onSelectSession,
  onDeleteSession,
}: {
  label: string;
  sessions: Array<{ key: string; displayName?: string; label?: string }>;
  currentSessionKey: string;
  isOnChat: boolean;
  getAgentName: (sessionKey: string) => string;
  getSessionLabel: (key: string, displayName?: string, label?: string) => string;
  onSelectSession: (key: string) => void;
  onDeleteSession: (key: string, label: string) => void;
}) {
  return (
    <div className="pt-2">
      <div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
        {label}
      </div>
      {sessions.map((session) => {
        const sessionLabel = getSessionLabel(session.key, session.displayName, session.label);
        return (
          <SessionListRow
            key={session.key}
            sessionKey={session.key}
            label={sessionLabel}
            agentName={getAgentName(session.key)}
            isActive={isOnChat && currentSessionKey === session.key}
            onSelect={() => onSelectSession(session.key)}
            onDelete={() => onDeleteSession(session.key, sessionLabel)}
          />
        );
      })}
    </div>
  );
});

const SessionListRow = memo(function SessionListRow({
  sessionKey,
  label,
  agentName,
  isActive,
  onSelect,
  onDelete,
}: {
  sessionKey: string;
  label: string;
  agentName: string;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div key={sessionKey} className="group relative flex items-center">
      <button
        onClick={onSelect}
        className={cn(
          'w-full rounded-2xl px-2.5 py-2 text-left text-[13px] transition-colors pr-7',
          'hover:bg-white/75',
          isActive
            ? 'bg-white/85 text-foreground font-medium shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_12px_24px_rgba(24,18,12,0.04)]'
            : 'text-foreground/75',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-full border border-black/6 bg-[#f1ece1] px-2 py-0.5 text-[10px] font-medium text-foreground/65 dark:bg-white/[0.08]">
            {agentName}
          </span>
          <span className="truncate">{label}</span>
        </div>
      </button>
      <button
        aria-label="Delete session"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={cn(
          'absolute right-1 flex items-center justify-center rounded p-0.5 transition-opacity',
          'opacity-0 group-hover:opacity-100',
          'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
