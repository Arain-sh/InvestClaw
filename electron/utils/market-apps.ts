import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { expandPath } from './paths';

type MarketAppCategory = 'broker' | 'terminal' | 'charting' | 'research';
type MarketAppPreset = {
  id: string;
  name: string;
  vendor: string;
  category: MarketAppCategory;
  description: string;
  websiteUrl: string;
  browserUrl: string;
  downloadUrl: string;
  macAppNames?: string[];
  windowsExecutableNames?: string[];
  linuxExecutableNames?: string[];
};

type MarketAppPreference = {
  customPath?: string;
  pinned?: boolean;
  lastLaunchedAt?: string;
  launchCount?: number;
};

type MarketAppsStoreShape = {
  apps: Record<string, MarketAppPreference>;
};

export type MarketAppDescriptor = {
  id: string;
  name: string;
  vendor: string;
  category: MarketAppCategory;
  description: string;
  websiteUrl: string;
  browserUrl: string;
  downloadUrl: string;
  platformSupported: boolean;
  platform: NodeJS.Platform;
  installed: boolean;
  pinned: boolean;
  source: 'builtin' | 'custom';
  installedPath: string | null;
  customPath: string;
  candidatePaths: string[];
  lastLaunchedAt: string | null;
  launchCount: number;
};

const DEFAULT_STORE: MarketAppsStoreShape = {
  apps: {
    futu: { pinned: true },
    tradingview: { pinned: true },
    ibkr: { pinned: true },
  },
};

const PRESETS: MarketAppPreset[] = [
  {
    id: 'futu',
    name: 'Futu NiuNiu',
    vendor: 'Futu',
    category: 'broker',
    description: '富途牛牛桌面终端，适合行情盯盘、自选股与下单联动。',
    websiteUrl: 'https://www.futunn.com/',
    browserUrl: 'https://www.futunn.com/stock',
    downloadUrl: 'https://www.futunn.com/download/full?lang=zh-cn',
    macAppNames: ['Futu.app', 'moomoo.app'],
    windowsExecutableNames: ['FutuNiuniu.exe', 'moomoo.exe'],
    linuxExecutableNames: ['moomoo'],
  },
  {
    id: 'tonghuashun',
    name: 'Tonghuashun',
    vendor: '同花顺',
    category: 'terminal',
    description: 'A 股与板块轮动观察常用的桌面行情终端。',
    websiteUrl: 'https://www.10jqka.com.cn/',
    browserUrl: 'https://www.10jqka.com.cn/',
    downloadUrl: 'https://download.10jqka.com.cn/',
    macAppNames: ['同花顺.app', 'Tonghuashun.app'],
    windowsExecutableNames: ['hexin.exe', '同花顺.exe'],
  },
  {
    id: 'eastmoney',
    name: 'Eastmoney',
    vendor: '东方财富',
    category: 'terminal',
    description: '东方财富终端，适合盘口、资讯和 A 股行情跟踪。',
    websiteUrl: 'https://www.eastmoney.com/',
    browserUrl: 'https://quote.eastmoney.com/center/gridlist.html',
    downloadUrl: 'https://emweb.securities.eastmoney.com/pc_hsf10/pages/index.html',
    macAppNames: ['东方财富.app', 'Eastmoney.app'],
    windowsExecutableNames: ['mainfree.exe', 'EastMoney.exe'],
  },
  {
    id: 'tradingview',
    name: 'TradingView Desktop',
    vendor: 'TradingView',
    category: 'charting',
    description: '图表、提醒和多屏盯盘最适合放在中间工作台的原生桌面版。',
    websiteUrl: 'https://www.tradingview.com/',
    browserUrl: 'https://www.tradingview.com/chart/',
    downloadUrl: 'https://www.tradingview.com/desktop/',
    macAppNames: ['TradingView.app'],
    windowsExecutableNames: ['TradingView.exe'],
    linuxExecutableNames: ['tradingview'],
  },
  {
    id: 'ibkr',
    name: 'IBKR Desktop',
    vendor: 'Interactive Brokers',
    category: 'broker',
    description: '适合多市场交易和美股盘前盘后执行的原生桌面终端。',
    websiteUrl: 'https://www.interactivebrokers.com/',
    browserUrl: 'https://www.interactivebrokers.com/en/trading/ibkr-desktop.php',
    downloadUrl: 'https://www.interactivebrokers.com/en/trading/ibkr-desktop.php',
    macAppNames: ['IBKR Desktop.app', 'Trader Workstation.app'],
    windowsExecutableNames: ['IBKR Desktop.exe', 'tws.exe'],
    linuxExecutableNames: ['ibkrdesktop', 'tws'],
  },
  {
    id: 'bloomberg',
    name: 'Bloomberg',
    vendor: 'Bloomberg',
    category: 'research',
    description: '新闻、宏观和多资产行情终端，可作为投研信息流主屏。',
    websiteUrl: 'https://www.bloomberg.com/professional',
    browserUrl: 'https://www.bloomberg.com/markets',
    downloadUrl: 'https://www.bloomberg.com/professional/support/software-updates/',
    macAppNames: ['Bloomberg.app'],
    windowsExecutableNames: ['wintrv.exe', 'Bloomberg.exe'],
  },
];

let marketAppsStoreInstance: import('electron-store').default<MarketAppsStoreShape> | null = null;

async function getMarketAppsStore() {
  if (!marketAppsStoreInstance) {
    const Store = (await import('electron-store')).default;
    marketAppsStoreInstance = new Store<MarketAppsStoreShape>({
      name: 'market-apps',
      defaults: DEFAULT_STORE,
    });
  }
  return marketAppsStoreInstance;
}

async function getPreferences(): Promise<Record<string, MarketAppPreference>> {
  const store = await getMarketAppsStore();
  return store.get('apps') || {};
}

async function setPreferences(nextApps: Record<string, MarketAppPreference>): Promise<void> {
  const store = await getMarketAppsStore();
  store.set('apps', nextApps);
}

function getCandidatePathsForPreset(preset: MarketAppPreset): string[] {
  const home = homedir();
  if (process.platform === 'darwin') {
    return (preset.macAppNames || []).flatMap((appName) => [
      join('/Applications', appName),
      join('/Applications/Setapp', appName),
      join(home, 'Applications', appName),
    ]);
  }

  if (process.platform === 'win32') {
    return (preset.windowsExecutableNames || []).flatMap((fileName) => [
      join(process.env['ProgramFiles'] || 'C:\\Program Files', basename(fileName, '.exe'), fileName),
      join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', basename(fileName, '.exe'), fileName),
      join(home, 'AppData', 'Local', basename(fileName, '.exe'), fileName),
    ]);
  }

  return (preset.linuxExecutableNames || []).flatMap((commandName) => [
    join('/usr/bin', commandName),
    join('/usr/local/bin', commandName),
    join(home, '.local', 'bin', commandName),
  ]);
}

function isPlatformSupported(preset: MarketAppPreset): boolean {
  if (process.platform === 'darwin') return Boolean(preset.macAppNames?.length);
  if (process.platform === 'win32') return Boolean(preset.windowsExecutableNames?.length);
  return Boolean(preset.linuxExecutableNames?.length);
}

function resolveInstalledPath(candidatePaths: string[], customPath: string): { installedPath: string | null; source: 'builtin' | 'custom' } {
  const normalizedCustomPath = customPath.trim() ? expandPath(customPath.trim()) : '';
  if (normalizedCustomPath && existsSync(normalizedCustomPath)) {
    return {
      installedPath: normalizedCustomPath,
      source: 'custom',
    };
  }

  const detectedPath = candidatePaths.find((path) => existsSync(path)) || null;
  return {
    installedPath: detectedPath,
    source: 'builtin',
  };
}

export async function listMarketApps(): Promise<{
  platform: NodeJS.Platform;
  apps: MarketAppDescriptor[];
}> {
  const preferences = await getPreferences();

  const apps = PRESETS.map((preset) => {
    const preference = preferences[preset.id] || {};
    const candidatePaths = getCandidatePathsForPreset(preset);
    const customPath = preference.customPath?.trim() || '';
    const { installedPath, source } = resolveInstalledPath(candidatePaths, customPath);

    return {
      id: preset.id,
      name: preset.name,
      vendor: preset.vendor,
      category: preset.category,
      description: preset.description,
      websiteUrl: preset.websiteUrl,
      browserUrl: preset.browserUrl,
      downloadUrl: preset.downloadUrl,
      platformSupported: isPlatformSupported(preset),
      platform: process.platform,
      installed: Boolean(installedPath),
      pinned: preference.pinned ?? false,
      source,
      installedPath,
      customPath,
      candidatePaths,
      lastLaunchedAt: preference.lastLaunchedAt || null,
      launchCount: preference.launchCount || 0,
    } satisfies MarketAppDescriptor;
  });

  apps.sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    if (left.installed !== right.installed) return left.installed ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  return {
    platform: process.platform,
    apps,
  };
}

export async function updateMarketApp(
  appId: string,
  updates: {
    customPath?: string;
    pinned?: boolean;
  },
): Promise<MarketAppDescriptor> {
  const preferences = await getPreferences();
  const current = preferences[appId] || {};

  preferences[appId] = {
    ...current,
    ...(updates.customPath !== undefined ? { customPath: updates.customPath.trim() } : {}),
    ...(updates.pinned !== undefined ? { pinned: updates.pinned } : {}),
  };

  await setPreferences(preferences);
  const snapshot = await listMarketApps();
  const descriptor = snapshot.apps.find((item) => item.id === appId);
  if (!descriptor) {
    throw new Error(`Unknown market app: ${appId}`);
  }
  return descriptor;
}

function launchProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function launchInstalledTarget(installedPath: string): Promise<void> {
  if (process.platform === 'darwin') {
    await launchProcess('open', ['-a', installedPath]);
    return;
  }

  if (process.platform === 'win32') {
    await launchProcess('cmd', ['/c', 'start', '', `"${installedPath}"`]);
    return;
  }

  if (installedPath.endsWith('.desktop')) {
    await launchProcess('xdg-open', [installedPath]);
    return;
  }

  await launchProcess(installedPath, []);
}

export async function launchMarketApp(appId: string): Promise<MarketAppDescriptor> {
  const snapshot = await listMarketApps();
  const descriptor = snapshot.apps.find((item) => item.id === appId);
  if (!descriptor) {
    throw new Error(`Unknown market app: ${appId}`);
  }

  if (!descriptor.platformSupported) {
    throw new Error(`"${descriptor.name}" is not supported on ${process.platform}`);
  }

  if (!descriptor.installed || !descriptor.installedPath) {
    throw new Error(`"${descriptor.name}" is not available yet. Configure a valid app path or install it first.`);
  }

  await launchInstalledTarget(descriptor.installedPath);

  const preferences = await getPreferences();
  const current = preferences[appId] || {};
  preferences[appId] = {
    ...current,
    lastLaunchedAt: new Date().toISOString(),
    launchCount: (current.launchCount || 0) + 1,
  };
  await setPreferences(preferences);

  const nextSnapshot = await listMarketApps();
  const nextDescriptor = nextSnapshot.apps.find((item) => item.id === appId);
  if (!nextDescriptor) {
    throw new Error(`Unknown market app: ${appId}`);
  }
  return nextDescriptor;
}

export function getMarketAppRevealPath(app: MarketAppDescriptor): string | null {
  if (!app.installedPath) return null;
  return process.platform === 'darwin' ? app.installedPath : dirname(app.installedPath);
}
