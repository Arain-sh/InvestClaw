/**
 * Chat Toolbar
 * Agent indicator plus quick toggles for thinking and workspace.
 * Rendered in the Header when on the Chat page.
 */
import { useMemo } from 'react';
import { Brain, Bot, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface ChatToolbarProps {
  workspaceVisible: boolean;
  onToggleWorkspace: () => void;
}

export function ChatToolbar({ workspaceVisible, onToggleWorkspace }: ChatToolbarProps) {
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const agents = useAgentsStore((s) => s.agents);
  const { t } = useTranslation('chat');
  const currentAgentName = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId)?.name ?? currentAgentId,
    [agents, currentAgentId],
  );

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-black/8 bg-white/80 px-3.5 py-1.5 text-[12px] font-medium text-foreground/75 shadow-[0_1px_0_rgba(255,255,255,0.85)_inset] dark:border-white/10 dark:bg-white/5">
        <Bot className="h-3.5 w-3.5 text-primary" />
        <span>{t('toolbar.currentAgent', { agent: currentAgentName })}</span>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-9 w-9 rounded-full border border-black/8 bg-white/75 text-muted-foreground shadow-[0_1px_0_rgba(255,255,255,0.85)_inset]',
              'hover:bg-white hover:text-foreground dark:border-white/10 dark:bg-white/5',
              showThinking && 'bg-primary/10 text-primary',
            )}
            onClick={toggleThinking}
          >
            <Brain className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-9 w-9 rounded-full border border-black/8 bg-white/75 text-muted-foreground shadow-[0_1px_0_rgba(255,255,255,0.85)_inset]',
              'hover:bg-white hover:text-foreground dark:border-white/10 dark:bg-white/5',
              workspaceVisible && 'bg-primary/10 text-primary',
            )}
            data-testid="chat-toolbar-workspace-toggle"
            onClick={onToggleWorkspace}
          >
            <Folder className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{workspaceVisible ? t('workspace.collapse') : t('workspace.expand')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
