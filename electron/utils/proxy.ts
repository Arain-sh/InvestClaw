/**
 * Proxy helpers shared by the Electron main process and Gateway launcher.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProxySettings {
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;
}

export interface ResolvedProxySettings {
  httpProxy: string;
  httpsProxy: string;
  allProxy: string;
  bypassRules: string;
}

export interface ElectronProxyConfig {
  mode: 'direct' | 'fixed_servers' | 'system';
  proxyRules?: string;
  proxyBypassRules?: string;
}

const BLANK_PROXY_ENV = {
  HTTP_PROXY: '',
  HTTPS_PROXY: '',
  ALL_PROXY: '',
  http_proxy: '',
  https_proxy: '',
  all_proxy: '',
  NO_PROXY: '',
  no_proxy: '',
} as const;

function trimValue(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Accept bare host:port values from users and normalize them to a valid URL.
 * Electron accepts scheme-less proxy rules in some cases, but child-process
 * env vars are more reliable when they are full URLs.
 */
export function normalizeProxyServer(proxyServer: string): string {
  const value = trimValue(proxyServer);
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `http://${value}`;
}

export function resolveProxySettings(settings: ProxySettings): ResolvedProxySettings {
  const legacyProxy = normalizeProxyServer(settings.proxyServer);
  const allProxy = normalizeProxyServer(settings.proxyAllServer);
  const httpProxy = normalizeProxyServer(settings.proxyHttpServer) || legacyProxy || allProxy;
  const httpsProxy = normalizeProxyServer(settings.proxyHttpsServer) || legacyProxy || allProxy;

  return {
    httpProxy,
    httpsProxy,
    allProxy: allProxy || legacyProxy,
    bypassRules: trimValue(settings.proxyBypassRules),
  };
}

export function buildElectronProxyConfig(settings: ProxySettings): ElectronProxyConfig {
  if (!settings.proxyEnabled) {
    return { mode: 'system' };
  }

  const resolved = resolveProxySettings(settings);
  const rules: string[] = [];

  if (resolved.httpProxy) {
    rules.push(`http=${resolved.httpProxy}`);
  }
  if (resolved.httpsProxy) {
    rules.push(`https=${resolved.httpsProxy}`);
  }

  // Fallback rule for protocols like ws/wss or when users only configured ALL_PROXY.
  const fallbackProxy = resolved.allProxy || resolved.httpsProxy || resolved.httpProxy;
  if (fallbackProxy) {
    rules.push(fallbackProxy);
  }

  if (rules.length === 0) {
    return { mode: 'direct' };
  }

  return {
    mode: 'fixed_servers',
    proxyRules: rules.join(';'),
    ...(resolved.bypassRules ? { proxyBypassRules: resolved.bypassRules } : {}),
  };
}

export function buildProxyEnvFromResolved(resolved: ResolvedProxySettings): Record<string, string> {
  const noProxy = resolved.bypassRules
    .split(/[,\n;]/)
    .map((rule) => rule.trim())
    .filter(Boolean)
    .join(',');

  return {
    HTTP_PROXY: resolved.httpProxy,
    HTTPS_PROXY: resolved.httpsProxy,
    ALL_PROXY: resolved.allProxy,
    http_proxy: resolved.httpProxy,
    https_proxy: resolved.httpsProxy,
    all_proxy: resolved.allProxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}

export function buildProxyEnv(settings: ProxySettings): Record<string, string> {
  if (!settings.proxyEnabled) {
    return { ...BLANK_PROXY_ENV };
  }

  return buildProxyEnvFromResolved(resolveProxySettings(settings));
}

function pickProxyValue(env: NodeJS.ProcessEnv, ...keys: string[]): string {
  for (const key of keys) {
    const value = trimValue(env[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

export function buildProxyEnvFromInheritedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const httpProxy = pickProxyValue(env, 'http_proxy', 'HTTP_PROXY');
  const httpsProxy = pickProxyValue(env, 'https_proxy', 'HTTPS_PROXY') || httpProxy;
  const allProxy = pickProxyValue(env, 'all_proxy', 'ALL_PROXY');
  const noProxy = pickProxyValue(env, 'no_proxy', 'NO_PROXY')
    .split(/[,\n;]/)
    .map((rule) => rule.trim())
    .filter(Boolean)
    .join(',');

  return {
    HTTP_PROXY: httpProxy,
    HTTPS_PROXY: httpsProxy,
    ALL_PROXY: allProxy,
    http_proxy: httpProxy,
    https_proxy: httpsProxy,
    all_proxy: allProxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}

function hasAnyProxyValue(proxyEnv: Record<string, string>): boolean {
  return Boolean(proxyEnv.HTTP_PROXY || proxyEnv.HTTPS_PROXY || proxyEnv.ALL_PROXY);
}

function parseScutilBooleanValue(output: string, key: string): boolean {
  const match = output.match(new RegExp(`\\b${key}\\s*:\\s*(\\d+)`));
  return match?.[1] === '1';
}

function parseScutilStringValue(output: string, key: string): string {
  const match = output.match(new RegExp(`\\b${key}\\s*:\\s*([^\\n]+)`));
  return trimValue(match?.[1] ?? '');
}

function parseScutilPortValue(output: string, key: string): string {
  const value = parseScutilStringValue(output, key);
  return /^\d+$/.test(value) ? value : '';
}

export function parseMacSystemProxySettings(output: string): ResolvedProxySettings | null {
  const httpEnabled = parseScutilBooleanValue(output, 'HTTPEnable');
  const httpsEnabled = parseScutilBooleanValue(output, 'HTTPSEnable');
  const socksEnabled = parseScutilBooleanValue(output, 'SOCKSEnable');

  const httpHost = httpEnabled ? parseScutilStringValue(output, 'HTTPProxy') : '';
  const httpsHost = httpsEnabled ? parseScutilStringValue(output, 'HTTPSProxy') : '';
  const socksHost = socksEnabled ? parseScutilStringValue(output, 'SOCKSProxy') : '';

  const httpPort = httpEnabled ? parseScutilPortValue(output, 'HTTPPort') : '';
  const httpsPort = httpsEnabled ? parseScutilPortValue(output, 'HTTPSPort') : '';
  const socksPort = socksEnabled ? parseScutilPortValue(output, 'SOCKSPort') : '';

  const httpProxy = httpHost && httpPort ? `http://${httpHost}:${httpPort}` : '';
  const httpsProxy = httpsHost && httpsPort ? `http://${httpsHost}:${httpsPort}` : '';
  const allProxy = socksHost && socksPort ? `socks5://${socksHost}:${socksPort}` : '';

  const exceptionsBlock = output.match(/ExceptionsList\s*:\s*<array>\s*{([\s\S]*?)^\s*}/m)?.[1] ?? '';
  const bypassRules = exceptionsBlock
    .split('\n')
    .map((line) => {
      const match = line.match(/:\s*(.+)$/);
      return trimValue(match?.[1] ?? '');
    })
    .filter(Boolean)
    .join(';');

  if (!httpProxy && !httpsProxy && !allProxy) {
    return null;
  }

  return {
    httpProxy,
    httpsProxy: httpsProxy || httpProxy,
    allProxy,
    bypassRules,
  };
}

export async function detectSystemProxySettings(): Promise<ResolvedProxySettings | null> {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('scutil', ['--proxy']);
    return parseMacSystemProxySettings(stdout);
  } catch {
    return null;
  }
}

export async function buildGatewayProxyEnv(
  settings: ProxySettings,
  options?: {
    inheritedEnv?: NodeJS.ProcessEnv;
    systemProxySettings?: ResolvedProxySettings | null;
  },
): Promise<Record<string, string>> {
  if (settings.proxyEnabled) {
    return buildProxyEnv(settings);
  }

  const inheritedEnv = buildProxyEnvFromInheritedEnv(options?.inheritedEnv ?? process.env);
  if (hasAnyProxyValue(inheritedEnv)) {
    return inheritedEnv;
  }

  const systemProxySettings = options?.systemProxySettings !== undefined
    ? options.systemProxySettings
    : await detectSystemProxySettings();
  if (systemProxySettings) {
    return buildProxyEnvFromResolved(systemProxySettings);
  }

  return { ...BLANK_PROXY_ENV };
}
