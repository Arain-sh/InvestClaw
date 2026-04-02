import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService } from '../gateway/clawhub';
import type { AimeSkillHubService } from '../gateway/aime-skillhub';
import type { HostEventBus } from './event-bus';

export interface HostApiContext {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  aimeSkillHubService: AimeSkillHubService;
  eventBus: HostEventBus;
  mainWindow: BrowserWindow | null;
}
