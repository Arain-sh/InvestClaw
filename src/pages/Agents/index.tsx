import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { subscribeHostEvent } from '@/lib/host-events';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import type {
  AgentSummary,
  AgentWorkspaceEntry,
  AgentWorkspaceFilePreview,
  AgentWorkspaceListing,
} from '@/types/agent';
import type { ProviderAccount, ProviderVendorInfo, ProviderWithKeyInfo } from '@/lib/providers';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

interface ChannelAccountItem {
  accountId: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
}

interface ChannelGroupItem {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  accounts: ChannelAccountItem[];
}

interface RuntimeProviderOption {
  runtimeProviderKey: string;
  accountId: string;
  label: string;
  modelIdPlaceholder?: string;
  configuredModelId?: string;
}

function resolveRuntimeProviderKey(account: ProviderAccount): string {
  if (account.authMode === 'oauth_browser') {
    if (account.vendorId === 'google') return 'google-gemini-cli';
    if (account.vendorId === 'openai') return 'openai-codex';
  }

  if (account.vendorId === 'custom' || account.vendorId === 'ollama') {
    const suffix = account.id.replace(/-/g, '').slice(0, 8);
    return `${account.vendorId}-${suffix}`;
  }

  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }

  return account.vendorId;
}

function splitModelRef(modelRef: string | null | undefined): { providerKey: string; modelId: string } | null {
  const value = (modelRef || '').trim();
  if (!value) return null;
  const separatorIndex = value.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) return null;
  return {
    providerKey: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  };
}

function hasConfiguredProviderCredentials(
  account: ProviderAccount,
  statusById: Map<string, ProviderWithKeyInfo>,
): boolean {
  if (account.authMode === 'oauth_device' || account.authMode === 'oauth_browser' || account.authMode === 'local') {
    return true;
  }
  return statusById.get(account.id)?.hasKey ?? false;
}

export function Agents() {
  const { t } = useTranslation('agents');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const refreshProviderSnapshot = useProviderStore((state) => state.refreshProviderSnapshot);
  const lastGatewayStateRef = useRef(gatewayStatus.state);
  const {
    agents,
    loading,
    error,
    fetchAgents,
    createAgent,
    deleteAgent,
  } = useAgentsStore();
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);

  const fetchChannelAccounts = useCallback(async () => {
    try {
      const response = await hostApiFetch<{ success: boolean; channels?: ChannelGroupItem[] }>('/api/channels/accounts');
      setChannelGroups(response.channels || []);
    } catch {
      setChannelGroups([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.all([fetchAgents(), fetchChannelAccounts(), refreshProviderSnapshot()]);
  }, [fetchAgents, fetchChannelAccounts, refreshProviderSnapshot]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      void fetchChannelAccounts();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchChannelAccounts]);

  useEffect(() => {
    const previousGatewayState = lastGatewayStateRef.current;
    lastGatewayStateRef.current = gatewayStatus.state;

    if (previousGatewayState !== 'running' && gatewayStatus.state === 'running') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchChannelAccounts();
    }
  }, [fetchChannelAccounts, gatewayStatus.state]);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );
  const handleRefresh = () => {
    void Promise.all([fetchAgents(), fetchChannelAccounts()]);
  };

  if (loading) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div data-testid="agents-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 shrink-0 gap-4">
          <div>
            <h1
              className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight"
              style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
            >
              {t('title')}
            </h1>
            <p className="text-[17px] text-foreground/70 font-medium">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={handleRefresh}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              {t('refresh')}
            </Button>
            <Button
              data-testid="agents-add-button"
              onClick={() => setShowAddDialog(true)}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              {t('addAgent')}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {gatewayStatus.state !== 'running' && (
            <div className="mb-8 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {error && (
            <div className="mb-8 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">
                {error}
              </span>
            </div>
          )}

          <div className="space-y-3">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                channelGroups={channelGroups}
                onOpenSettings={() => setActiveAgentId(agent.id)}
                onDelete={() => setAgentToDelete(agent)}
              />
            ))}
          </div>
        </div>
      </div>

      {showAddDialog && (
        <AddAgentDialog
          onClose={() => setShowAddDialog(false)}
          onCreate={async (name, options) => {
            await createAgent(name, options);
            setShowAddDialog(false);
            toast.success(t('toast.agentCreated'));
          }}
        />
      )}

      {activeAgent && (
        <AgentSettingsModal
          agent={activeAgent}
          channelGroups={channelGroups}
          onClose={() => setActiveAgentId(null)}
        />
      )}

      <ConfirmDialog
        open={!!agentToDelete}
        title={t('deleteDialog.title')}
        message={agentToDelete ? t('deleteDialog.message', { name: agentToDelete.name }) : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!agentToDelete) return;
          try {
            await deleteAgent(agentToDelete.id);
            const deletedId = agentToDelete.id;
            setAgentToDelete(null);
            if (activeAgentId === deletedId) {
              setActiveAgentId(null);
            }
            toast.success(t('toast.agentDeleted'));
          } catch (error) {
            toast.error(t('toast.agentDeleteFailed', { error: String(error) }));
          }
        }}
        onCancel={() => setAgentToDelete(null)}
      />
    </div>
  );
}

function AgentCard({
  agent,
  channelGroups,
  onOpenSettings,
  onDelete,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroupItem[];
  onOpenSettings: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('agents');
  const boundChannelAccounts = channelGroups.flatMap((group) =>
    group.accounts
      .filter((account) => account.agentId === agent.id)
      .map((account) => {
        const channelName = CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType;
        const accountLabel =
          account.accountId === 'default'
            ? t('settingsDialog.mainAccount')
            : account.name || account.accountId;
        return `${channelName} · ${accountLabel}`;
      }),
  );
  const channelsText = boundChannelAccounts.length > 0
    ? boundChannelAccounts.join(', ')
    : t('none');

  return (
    <div
      className={cn(
        'group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-transparent border-transparent hover:bg-black/5 dark:hover:bg-white/5',
        agent.isDefault && 'bg-black/[0.04] dark:bg-white/[0.06]'
      )}
    >
      <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-primary bg-primary/10 rounded-full shadow-sm mb-3">
        <Bot className="h-[22px] w-[22px]" />
      </div>
      <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-[16px] font-semibold text-foreground truncate">{agent.name}</h2>
            {agent.isDefault && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
              >
                <Check className="h-3 w-3" />
                {t('defaultBadge')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!agent.isDefault && (
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                onClick={onDelete}
                title={t('deleteAgent')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              data-testid={`agents-card-settings-${agent.id}`}
              className={cn(
                'h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-all',
                !agent.isDefault && 'opacity-0 group-hover:opacity-100',
              )}
              onClick={onOpenSettings}
              title={t('settings')}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
          {t('modelLine', {
            model: agent.modelDisplay,
            suffix: agent.inheritedModel ? ` (${t('inherited')})` : '',
          })}
        </p>
        <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
          {t('channelsLine', { channels: channelsText })}
        </p>
      </div>
    </div>
  );
}

const inputClasses = 'h-[44px] rounded-xl font-mono text-[13px] bg-[#eeece3] dark:bg-muted border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const selectClasses = 'h-[44px] w-full rounded-xl font-mono text-[13px] bg-[#eeece3] dark:bg-muted border border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground px-3';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[20px] h-[20px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[20px] h-[20px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[20px] h-[20px] dark:invert" />;
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[20px] h-[20px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[20px] h-[20px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[20px] h-[20px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[20px] h-[20px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[20px] h-[20px] dark:invert" />;
    default:
      return <span className="text-[20px] leading-none">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

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

function formatWorkspaceTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
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
  const { t } = useTranslation('agents');

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (!preview) {
    return (
      <div
        data-testid="agents-workspace-preview"
        className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-black/10 bg-black/5 px-6 text-center dark:border-white/10 dark:bg-white/5"
      >
        <FileText className="mb-3 h-6 w-6 text-foreground/45" />
        <p className="text-[14px] font-medium text-foreground/80">{t('settingsDialog.workspaceSelectFile')}</p>
        <p className="mt-1 font-mono text-[12px] text-foreground/55">
          {listing?.currentContainerPath || '/workspace'}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="agents-workspace-preview" className="rounded-2xl border border-black/10 bg-black/5 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="mb-4 space-y-1">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
          <FileText className="h-4 w-4 text-foreground/55" />
          <span>{preview.name}</span>
        </div>
        <p className="font-mono text-[12px] text-foreground/70 break-all">{preview.containerPath}</p>
        <p className="font-mono text-[12px] text-foreground/55 break-all">{preview.hostPath}</p>
        <p className="text-[12px] text-foreground/55">
          {preview.mimeType} · {formatByteSize(preview.size)} · {formatWorkspaceTimestamp(preview.modifiedAt)}
        </p>
      </div>

      {preview.kind === 'image' && preview.dataUrl && (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-[#f8f6ef] p-3 dark:border-white/10 dark:bg-black/10">
          <img src={preview.dataUrl} alt={preview.name} className="max-h-[420px] w-full rounded-xl object-contain" />
        </div>
      )}

      {preview.kind === 'image' && !preview.dataUrl && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-[#f8f6ef] p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
          {t('settingsDialog.workspaceImageTooLarge')}
        </div>
      )}

      {preview.kind === 'text' && preview.extension === '.md' && (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-[#f8f6ef] dark:border-white/10 dark:bg-black/10">
          <div className="prose prose-sm max-w-none px-4 py-4 prose-headings:font-serif prose-pre:bg-black prose-pre:text-white dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content || ''}</ReactMarkdown>
          </div>
          {preview.truncated && (
            <div className="border-t border-black/10 px-4 py-2 text-[12px] text-foreground/60 dark:border-white/10">
              {t('settingsDialog.workspacePreviewTruncated')}
            </div>
          )}
        </div>
      )}

      {preview.kind === 'text' && preview.extension !== '.md' && (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-[#f8f6ef] dark:border-white/10 dark:bg-black/10">
          <pre className="max-h-[420px] overflow-auto px-4 py-4 font-mono text-[12px] leading-5 text-foreground">
            {preview.content}
          </pre>
          {preview.truncated && (
            <div className="border-t border-black/10 px-4 py-2 text-[12px] text-foreground/60 dark:border-white/10">
              {t('settingsDialog.workspacePreviewTruncated')}
            </div>
          )}
        </div>
      )}

      {preview.kind === 'binary' && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-[#f8f6ef] p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
          {t('settingsDialog.workspaceUnsupportedPreview')}
        </div>
      )}
    </div>
  );
}

function AddAgentDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, options: { inheritWorkspace: boolean; workspace?: string }) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [inheritWorkspace, setInheritWorkspace] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate(name.trim(), {
        inheritWorkspace,
        workspace: workspace.trim() || undefined,
      });
    } catch (error) {
      toast.error(t('toast.agentCreateFailed', { error: String(error) }));
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card data-testid="agents-add-dialog" className="w-full max-w-lg rounded-3xl border-0 shadow-2xl bg-[#f3f1e9] dark:bg-card overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl font-serif font-normal tracking-tight">
            {t('createDialog.title')}
          </CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('createDialog.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 p-6">
          <div className="space-y-2.5">
            <Label htmlFor="agent-name" className={labelClasses}>{t('createDialog.nameLabel')}</Label>
            <Input
              id="agent-name"
              data-testid="agents-create-name-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
              className={inputClasses}
            />
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="agent-workspace" className={labelClasses}>{t('createDialog.workspaceLabel')}</Label>
            <Input
              id="agent-workspace"
              data-testid="agents-create-workspace-input"
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
              placeholder={t('createDialog.workspacePlaceholder')}
              className={inputClasses}
            />
            <p className="text-[13px] text-foreground/60">{t('createDialog.workspaceDescription')}</p>
            <div className="rounded-2xl border border-black/10 bg-black/5 px-4 py-3 dark:border-white/10 dark:bg-white/5">
              <p className="text-[11px] uppercase tracking-[0.08em] text-foreground/55">
                {t('createDialog.containerWorkspaceLabel')}
              </p>
              <p className="mt-1 font-mono text-[12px] text-foreground/80">/workspace</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="inherit-workspace" className={labelClasses}>{t('createDialog.inheritWorkspaceLabel')}</Label>
              <p className="text-[13px] text-foreground/60">{t('createDialog.inheritWorkspaceDescription')}</p>
            </div>
            <Switch
              id="inherit-workspace"
              checked={inheritWorkspace}
              onCheckedChange={setInheritWorkspace}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              data-testid="agents-add-save-button"
              onClick={() => void handleSubmit()}
              disabled={saving || !name.trim()}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                t('common:actions.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentSettingsModal({
  agent,
  channelGroups,
  onClose,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroupItem[];
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const { updateAgent, updateAgentWorkspace, defaultModelRef } = useAgentsStore();
  const [name, setName] = useState(agent.name);
  const [workspaceInput, setWorkspaceInput] = useState(agent.workspace);
  const [savingName, setSavingName] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [workspaceListing, setWorkspaceListing] = useState<AgentWorkspaceListing | null>(null);
  const [workspacePreview, setWorkspacePreview] = useState<AgentWorkspaceFilePreview | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspacePreviewLoading, setWorkspacePreviewLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);

  useEffect(() => {
    setName(agent.name);
  }, [agent.name]);

  useEffect(() => {
    setWorkspaceInput(agent.workspace);
  }, [agent.workspace]);

  const loadWorkspaceListing = useCallback(async (relativePath = '') => {
    setWorkspaceLoading(true);
    try {
      const response = await hostApiFetch<AgentWorkspaceListing>(buildWorkspaceBrowserPath(agent.id, relativePath));
      setWorkspaceListing(response);
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(String(error));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    setWorkspacePreview(null);
    setSelectedWorkspacePath(null);
    void loadWorkspaceListing('');
  }, [agent.id, agent.workspace, loadWorkspaceListing]);

  const hasNameChanges = name.trim() !== agent.name;
  const hasWorkspaceChanges = workspaceInput.trim() !== agent.workspace;

  const handleRequestClose = () => {
    if (savingName || savingWorkspace || hasNameChanges || hasWorkspaceChanges) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === agent.name) return;
    setSavingName(true);
    try {
      await updateAgent(agent.id, name.trim());
      toast.success(t('toast.agentUpdated'));
    } catch (error) {
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveWorkspace = async () => {
    if (!workspaceInput.trim() || workspaceInput.trim() === agent.workspace) return;
    setSavingWorkspace(true);
    try {
      await updateAgentWorkspace(agent.id, workspaceInput.trim());
      toast.success(t('toast.workspaceUpdated'));
      setWorkspacePreview(null);
      setSelectedWorkspacePath(null);
    } catch (error) {
      toast.error(t('toast.workspaceUpdateFailed', { error: String(error) }));
    } finally {
      setSavingWorkspace(false);
    }
  };

  const handleOpenWorkspaceEntry = async (entry: AgentWorkspaceEntry) => {
    if (entry.kind === 'symlink') {
      toast.error(t('toast.workspaceSymlinkUnsupported'));
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
      const response = await hostApiFetch<AgentWorkspaceFilePreview>(buildWorkspacePreviewPath(agent.id, entry.relativePath));
      setWorkspacePreview(response);
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(String(error));
      toast.error(t('toast.workspaceLoadFailed', { error: String(error) }));
    } finally {
      setWorkspacePreviewLoading(false);
    }
  };

  const handleOpenWorkspaceFolder = async () => {
    const targetPath = workspaceListing?.hostPath || agent.workspace;
    const result = await invokeIpc<string>('shell:openPath', targetPath);
    if (result) {
      toast.error(t('toast.workspaceOpenFolderFailed', { error: result }));
    }
  };

  const assignedChannels = channelGroups.flatMap((group) =>
    group.accounts
      .filter((account) => account.agentId === agent.id)
      .map((account) => ({
        channelType: group.channelType as ChannelType,
        accountId: account.accountId,
        name:
          account.accountId === 'default'
            ? t('settingsDialog.mainAccount')
            : account.name || account.accountId,
        error: account.lastError,
      })),
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card data-testid="agents-settings-modal" className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-[#f3f1e9] dark:bg-card overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">
              {t('settingsDialog.title', { name: agent.name })}
            </CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">
              {t('settingsDialog.description')}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRequestClose}
            className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 p-6 pt-4">
          <Tabs defaultValue="overview" className="space-y-5">
            <TabsList className="grid w-full grid-cols-2 rounded-2xl bg-black/5 p-1 dark:bg-white/5">
              <TabsTrigger value="overview">{t('settingsDialog.overviewTab')}</TabsTrigger>
              <TabsTrigger data-testid="agents-workspace-tab" value="workspace">{t('settingsDialog.workspaceTab')}</TabsTrigger>
            </TabsList>

            <TabsContent forceMount value="overview" className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2.5">
                  <Label htmlFor="agent-settings-name" className={labelClasses}>{t('settingsDialog.nameLabel')}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="agent-settings-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      readOnly={agent.isDefault}
                      className={inputClasses}
                    />
                    {!agent.isDefault && (
                      <Button
                        variant="outline"
                        onClick={() => void handleSaveName()}
                        disabled={savingName || !name.trim() || name.trim() === agent.name}
                        className="h-[44px] text-[13px] font-medium rounded-xl px-4 border-black/10 dark:border-white/10 bg-[#eeece3] dark:bg-muted hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
                      >
                        {savingName ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          t('common:actions.save')
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1 rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                      {t('settingsDialog.agentIdLabel')}
                    </p>
                    <p className="font-mono text-[13px] text-foreground">{agent.id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowModelModal(true)}
                    className="space-y-1 rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4 text-left hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                  >
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                      {t('settingsDialog.modelLabel')}
                    </p>
                    <p className="text-[13.5px] text-foreground">
                      {agent.modelDisplay}
                      {agent.inheritedModel ? ` (${t('inherited')})` : ''}
                    </p>
                    <p className="font-mono text-[12px] text-foreground/70 break-all">
                      {agent.modelRef || defaultModelRef || '-'}
                    </p>
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">
                      {t('settingsDialog.channelsTitle')}
                    </h3>
                    <p className="text-[14px] text-foreground/70 mt-1">{t('settingsDialog.channelsDescription')}</p>
                  </div>
                </div>

                {assignedChannels.length === 0 && agent.channelTypes.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-[13.5px] text-muted-foreground">
                    {t('settingsDialog.noChannels')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {assignedChannels.map((channel) => (
                      <div key={`${channel.channelType}-${channel.accountId}`} className="flex items-center justify-between rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-[40px] w-[40px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm">
                            <ChannelLogo type={channel.channelType} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-foreground">{channel.name}</p>
                            <p className="text-[13.5px] text-muted-foreground">
                              {CHANNEL_NAMES[channel.channelType]} · {channel.accountId === 'default' ? t('settingsDialog.mainAccount') : channel.accountId}
                            </p>
                            {channel.error && (
                              <p className="text-xs text-destructive mt-1">{channel.error}</p>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0" />
                      </div>
                    ))}
                    {assignedChannels.length === 0 && agent.channelTypes.length > 0 && (
                      <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-[13.5px] text-muted-foreground">
                        {t('settingsDialog.channelsManagedInChannels')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent forceMount value="workspace" className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">
                    {t('settingsDialog.workspaceTitle')}
                  </h3>
                  <p className="mt-1 text-[14px] text-foreground/70">{t('settingsDialog.workspaceDescription')}</p>
                </div>

                <div className="space-y-2.5">
                  <Label htmlFor="agent-workspace-settings" className={labelClasses}>{t('settingsDialog.workspacePathLabel')}</Label>
                  <div className="flex flex-col gap-2 md:flex-row">
                    <Input
                      id="agent-workspace-settings"
                      data-testid="agents-workspace-path-input"
                      value={workspaceInput}
                      onChange={(event) => setWorkspaceInput(event.target.value)}
                      className={inputClasses}
                    />
                    <Button
                      variant="outline"
                      data-testid="agents-workspace-save-button"
                      onClick={() => void handleSaveWorkspace()}
                      disabled={savingWorkspace || !workspaceInput.trim() || workspaceInput.trim() === agent.workspace}
                      className="h-[44px] text-[13px] font-medium rounded-xl px-4 border-black/10 dark:border-white/10 bg-[#eeece3] dark:bg-muted hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
                    >
                      {savingWorkspace ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        t('common:actions.save')
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleOpenWorkspaceFolder()}
                      disabled={!workspaceListing?.exists}
                      className="h-[44px] text-[13px] font-medium rounded-xl px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
                    >
                      <FolderOpen className="mr-2 h-4 w-4" />
                      {t('settingsDialog.workspaceOpenFolder')}
                    </Button>
                  </div>
                  <p className="text-[13px] text-foreground/60">
                    {hasWorkspaceChanges ? t('settingsDialog.workspaceUnsavedHint') : t('settingsDialog.workspaceSavedHint')}
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="rounded-2xl border border-transparent bg-black/5 p-4 dark:bg-white/5">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-foreground/55">{t('settingsDialog.workspaceConfiguredLabel')}</p>
                    <p className="mt-1 font-mono text-[12px] text-foreground break-all">
                      {workspaceListing?.configuredPath || agent.workspace}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-transparent bg-black/5 p-4 dark:bg-white/5">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-foreground/55">{t('settingsDialog.workspaceHostPathLabel')}</p>
                    <p className="mt-1 font-mono text-[12px] text-foreground break-all">
                      {workspaceListing?.hostPath || agent.workspace}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-transparent bg-black/5 p-4 dark:bg-white/5">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-foreground/55">{t('settingsDialog.workspaceContainerPathLabel')}</p>
                    <p className="mt-1 font-mono text-[12px] text-foreground break-all">
                      {workspaceListing?.currentContainerPath || '/workspace'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h4 className="text-lg font-serif font-normal tracking-tight text-foreground">
                      {t('settingsDialog.workspaceExplorerTitle')}
                    </h4>
                    <p className="mt-1 text-[14px] text-foreground/70">
                      {t('settingsDialog.workspaceExplorerDescription')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void loadWorkspaceListing(workspaceListing?.currentRelativePath || '')}
                    className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    {t('settingsDialog.workspaceRefresh')}
                  </Button>
                </div>

                {workspaceError && (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-[13px] text-destructive">
                    {workspaceError}
                  </div>
                )}

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1.85fr)]">
                  <div data-testid="agents-workspace-explorer" className="rounded-2xl border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/5">
                    <div className="mb-3 rounded-2xl border border-black/10 bg-[#f8f6ef] px-4 py-3 dark:border-white/10 dark:bg-black/10">
                      <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.08em] text-foreground/55">
                        <HardDrive className="h-3.5 w-3.5" />
                        {t('settingsDialog.workspaceContainerPathLabel')}
                      </div>
                      <p className="mt-1 font-mono text-[12px] text-foreground break-all">
                        {workspaceListing?.currentContainerPath || '/workspace'}
                      </p>
                    </div>

                    {workspaceLoading ? (
                      <div className="flex min-h-[320px] items-center justify-center">
                        <LoadingSpinner size="md" />
                      </div>
                    ) : !workspaceListing?.exists ? (
                      <div className="rounded-2xl border border-dashed border-black/10 bg-[#f8f6ef] p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
                        {t('settingsDialog.workspaceMissing')}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {workspaceListing.parentRelativePath !== null && (
                          <button
                            type="button"
                            onClick={() => void loadWorkspaceListing(workspaceListing.parentRelativePath || '')}
                            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                          >
                            <FolderOpen className="h-4 w-4 text-foreground/55" />
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-foreground">{t('settingsDialog.workspaceParentDirectory')}</p>
                              <p className="font-mono text-[11px] text-foreground/55">
                                {workspaceListing.parentRelativePath || '/workspace'}
                              </p>
                            </div>
                          </button>
                        )}

                        {workspaceListing.entries.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-black/10 bg-[#f8f6ef] p-4 text-[13px] text-foreground/65 dark:border-white/10 dark:bg-black/10">
                            {t('settingsDialog.workspaceEmpty')}
                          </div>
                        ) : (
                          workspaceListing.entries.map((entry) => (
                            <button
                              key={entry.relativePath}
                              type="button"
                              data-testid={entry.kind === 'file' ? `agents-workspace-file-${entry.name}` : undefined}
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
                                  {entry.containerPath} · {entry.kind === 'directory' ? t('settingsDialog.workspaceDirectory') : formatByteSize(entry.size)}
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
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      {showModelModal && (
        <AgentModelModal
          agent={agent}
          onClose={() => setShowModelModal(false)}
        />
      )}
      <ConfirmDialog
        open={showCloseConfirm}
        title={t('settingsDialog.unsavedChangesTitle')}
        message={t('settingsDialog.unsavedChangesMessage')}
        confirmLabel={t('settingsDialog.closeWithoutSaving')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={() => {
          setShowCloseConfirm(false);
          setName(agent.name);
          setWorkspaceInput(agent.workspace);
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </div>
  );
}

function AgentModelModal({
  agent,
  onClose,
}: {
  agent: AgentSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const providerAccounts = useProviderStore((state) => state.accounts);
  const providerStatuses = useProviderStore((state) => state.statuses);
  const providerVendors = useProviderStore((state) => state.vendors);
  const providerDefaultAccountId = useProviderStore((state) => state.defaultAccountId);
  const { updateAgentModel, defaultModelRef } = useAgentsStore();
  const [selectedRuntimeProviderKey, setSelectedRuntimeProviderKey] = useState('');
  const [modelIdInput, setModelIdInput] = useState('');
  const [savingModel, setSavingModel] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const runtimeProviderOptions = useMemo<RuntimeProviderOption[]>(() => {
    const vendorMap = new Map<string, ProviderVendorInfo>(providerVendors.map((vendor) => [vendor.id, vendor]));
    const statusById = new Map<string, ProviderWithKeyInfo>(providerStatuses.map((status) => [status.id, status]));
    const entries = providerAccounts
      .filter((account) => account.enabled && hasConfiguredProviderCredentials(account, statusById))
      .sort((left, right) => {
        if (left.id === providerDefaultAccountId) return -1;
        if (right.id === providerDefaultAccountId) return 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      });

    const deduped = new Map<string, RuntimeProviderOption>();
    for (const account of entries) {
      const runtimeProviderKey = resolveRuntimeProviderKey(account);
      if (!runtimeProviderKey || deduped.has(runtimeProviderKey)) continue;
      const vendor = vendorMap.get(account.vendorId);
      const label = `${account.label} (${vendor?.name || account.vendorId})`;
      const configuredModelId = account.model
        ? (account.model.startsWith(`${runtimeProviderKey}/`)
          ? account.model.slice(runtimeProviderKey.length + 1)
          : account.model)
        : undefined;

      deduped.set(runtimeProviderKey, {
        runtimeProviderKey,
        accountId: account.id,
        label,
        modelIdPlaceholder: vendor?.modelIdPlaceholder,
        configuredModelId,
      });
    }

    return [...deduped.values()];
  }, [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors]);

  useEffect(() => {
    const override = splitModelRef(agent.overrideModelRef);
    if (override) {
      setSelectedRuntimeProviderKey(override.providerKey);
      setModelIdInput(override.modelId);
      return;
    }

    const effective = splitModelRef(agent.modelRef || defaultModelRef);
    if (effective) {
      setSelectedRuntimeProviderKey(effective.providerKey);
      setModelIdInput(effective.modelId);
      return;
    }

    setSelectedRuntimeProviderKey(runtimeProviderOptions[0]?.runtimeProviderKey || '');
    setModelIdInput('');
  }, [agent.modelRef, agent.overrideModelRef, defaultModelRef, runtimeProviderOptions]);

  const selectedProvider = runtimeProviderOptions.find((option) => option.runtimeProviderKey === selectedRuntimeProviderKey) || null;
  const trimmedModelId = modelIdInput.trim();
  const nextModelRef = selectedRuntimeProviderKey && trimmedModelId
    ? `${selectedRuntimeProviderKey}/${trimmedModelId}`
    : '';
  const normalizedDefaultModelRef = (defaultModelRef || '').trim();
  const isUsingDefaultModelInForm = Boolean(normalizedDefaultModelRef) && nextModelRef === normalizedDefaultModelRef;
  const currentOverrideModelRef = (agent.overrideModelRef || '').trim();
  const desiredOverrideModelRef = nextModelRef && nextModelRef !== normalizedDefaultModelRef
    ? nextModelRef
    : null;
  const modelChanged = (desiredOverrideModelRef || '') !== currentOverrideModelRef;

  const handleRequestClose = () => {
    if (savingModel || modelChanged) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleSaveModel = async () => {
    if (!selectedRuntimeProviderKey) {
      toast.error(t('toast.agentModelProviderRequired'));
      return;
    }
    if (!trimmedModelId) {
      toast.error(t('toast.agentModelIdRequired'));
      return;
    }
    if (!modelChanged) return;
    if (!nextModelRef.includes('/')) {
      toast.error(t('toast.agentModelInvalid'));
      return;
    }

    setSavingModel(true);
    try {
      await updateAgentModel(agent.id, desiredOverrideModelRef);
      toast.success(desiredOverrideModelRef ? t('toast.agentModelUpdated') : t('toast.agentModelReset'));
      onClose();
    } catch (error) {
      toast.error(t('toast.agentModelUpdateFailed', { error: String(error) }));
    } finally {
      setSavingModel(false);
    }
  };

  const handleUseDefaultModel = () => {
    const parsedDefault = splitModelRef(normalizedDefaultModelRef);
    if (!parsedDefault) {
      setSelectedRuntimeProviderKey('');
      setModelIdInput('');
      return;
    }
    setSelectedRuntimeProviderKey(parsedDefault.providerKey);
    setModelIdInput(parsedDefault.modelId);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-xl rounded-3xl border-0 shadow-2xl bg-[#f3f1e9] dark:bg-card overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">
              {t('settingsDialog.modelLabel')}
            </CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">
              {t('settingsDialog.modelOverrideDescription', { defaultModel: defaultModelRef || '-' })}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRequestClose}
            className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 p-6 pt-4">
          <div className="space-y-2">
            <Label htmlFor="agent-model-provider" className="text-[12px] text-foreground/70">{t('settingsDialog.modelProviderLabel')}</Label>
            <select
              id="agent-model-provider"
              value={selectedRuntimeProviderKey}
              onChange={(event) => {
                const nextProvider = event.target.value;
                setSelectedRuntimeProviderKey(nextProvider);
                if (!modelIdInput.trim()) {
                  const option = runtimeProviderOptions.find((candidate) => candidate.runtimeProviderKey === nextProvider);
                  setModelIdInput(option?.configuredModelId || '');
                }
              }}
              className={selectClasses}
            >
              <option value="">{t('settingsDialog.modelProviderPlaceholder')}</option>
              {runtimeProviderOptions.map((option) => (
                <option key={option.runtimeProviderKey} value={option.runtimeProviderKey}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-model-id" className="text-[12px] text-foreground/70">{t('settingsDialog.modelIdLabel')}</Label>
            <Input
              id="agent-model-id"
              value={modelIdInput}
              onChange={(event) => setModelIdInput(event.target.value)}
              placeholder={selectedProvider?.modelIdPlaceholder || selectedProvider?.configuredModelId || t('settingsDialog.modelIdPlaceholder')}
              className={inputClasses}
            />
          </div>
          {!!nextModelRef && (
            <p className="text-[12px] font-mono text-foreground/70 break-all">
              {t('settingsDialog.modelPreview')}: {nextModelRef}
            </p>
          )}
          {runtimeProviderOptions.length === 0 && (
            <p className="text-[12px] text-amber-600 dark:text-amber-400">
              {t('settingsDialog.modelProviderEmpty')}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleUseDefaultModel}
              disabled={savingModel || !normalizedDefaultModelRef || isUsingDefaultModelInForm}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('settingsDialog.useDefaultModel')}
            </Button>
            <Button
              variant="outline"
              onClick={handleRequestClose}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              data-testid="agents-model-save-button"
              onClick={() => void handleSaveModel()}
              disabled={savingModel || !selectedRuntimeProviderKey || !trimmedModelId || !modelChanged}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              {savingModel ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                t('common:actions.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={showCloseConfirm}
        title={t('settingsDialog.unsavedChangesTitle')}
        message={t('settingsDialog.unsavedChangesMessage')}
        confirmLabel={t('settingsDialog.closeWithoutSaving')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={() => {
          setShowCloseConfirm(false);
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </div>
  );
}

export default Agents;
