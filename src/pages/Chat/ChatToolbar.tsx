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
  hideUtilityToggles?: boolean;
}

export function ChatToolbar({ workspaceVisible, onToggleWorkspace, hideUtilityToggles = false }: ChatToolbarProps) {
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const agents = useAgentsStore((s) => s.agents);
  const { t } = useTranslation('chat');
  const currentAgentName = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId)?.name ?? currentAgentId,
    [agents, currentAgentId],
  );
  const toggleButtonClassName =
    'h-8.5 w-8.5 rounded-full border border-transparent bg-transparent p-0 shadow-none transition-[color,opacity,filter,transform] duration-150 hover:bg-transparent active:scale-[0.95]';
  const inactiveToggleClassName =
    'text-foreground/30 hover:text-foreground/66 dark:text-white/48 dark:hover:text-white/80';
  const activeToggleClassName =
    'text-[#0f8a61] drop-shadow-[0_0_12px_rgba(15,138,97,0.16)] hover:text-[#0c7b56] dark:text-[#68e0af] dark:drop-shadow-[0_0_12px_rgba(104,224,175,0.22)] dark:hover:text-[#85ebbf]';

  return (
    <div className="app-chrome flex items-center gap-1.5 md:gap-2">
      <div className="hidden xl:flex items-center gap-1.5 rounded-full border border-slate-300/45 bg-white/64 px-3.5 py-1.5 text-[12px] font-medium text-foreground/72 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
        <Bot className="h-3.5 w-3.5 text-primary" />
        <span>{t('toolbar.currentAgent', { agent: currentAgentName })}</span>
      </div>

      {!hideUtilityToggles ? (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  toggleButtonClassName,
                  showThinking ? activeToggleClassName : inactiveToggleClassName,
                )}
                aria-pressed={showThinking}
                data-testid="chat-toolbar-thinking-toggle"
                onClick={toggleThinking}
              >
                <Brain className="h-[1.1rem] w-[1.1rem]" />
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
                  toggleButtonClassName,
                  workspaceVisible ? activeToggleClassName : inactiveToggleClassName,
                )}
                aria-pressed={workspaceVisible}
                data-testid="chat-toolbar-workspace-toggle"
                onClick={onToggleWorkspace}
              >
                <Folder className="h-[1.1rem] w-[1.1rem]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{workspaceVisible ? t('workspace.collapse') : t('workspace.expand')}</p>
            </TooltipContent>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}
