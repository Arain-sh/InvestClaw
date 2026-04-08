export type MarketAppCategory = 'broker' | 'terminal' | 'charting' | 'research';

export interface MarketAppDescriptor {
  success?: boolean;
  id: string;
  name: string;
  vendor: string;
  category: MarketAppCategory;
  description: string;
  websiteUrl: string;
  browserUrl: string;
  downloadUrl: string;
  platformSupported: boolean;
  platform: string;
  installed: boolean;
  pinned: boolean;
  source: 'builtin' | 'custom';
  installedPath: string | null;
  customPath: string;
  candidatePaths: string[];
  lastLaunchedAt: string | null;
  launchCount: number;
}

export interface MarketAppsSnapshot {
  success?: boolean;
  platform: string;
  apps: MarketAppDescriptor[];
}
