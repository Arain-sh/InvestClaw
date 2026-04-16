/**
 * Proxy helpers shared by the Electron main process and Gateway launcher.
 */
import { execFileSync } from 'node:child_process';

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
  mode: 'direct' | 'fixed_servers';
  proxyRules?: string;
  proxyBypassRules?: string;
}

export interface ProxyResolutionOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  systemProxyOutput?: string;
  fallbackBypassRules?: string;
}

function trimValue(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasAnyProxy(settings: ResolvedProxySettings): boolean {
  return Boolean(settings.httpProxy || settings.httpsProxy || settings.allProxy);
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

function resolveProxySettingsFromEnv(
  env: NodeJS.ProcessEnv,
  fallbackBypassRules = '',
): ResolvedProxySettings {
  return {
    httpProxy: normalizeProxyServer(env.HTTP_PROXY || env.http_proxy || ''),
    httpsProxy: normalizeProxyServer(env.HTTPS_PROXY || env.https_proxy || ''),
    allProxy: normalizeProxyServer(env.ALL_PROXY || env.all_proxy || ''),
    bypassRules: trimValue(env.NO_PROXY || env.no_proxy || fallbackBypassRules),
  };
}

export function parseMacSystemProxyOutput(
  output: string,
  fallbackBypassRules = '',
): ResolvedProxySettings {
  const values: Record<string, string> = {};
  const exceptions: string[] = [];
  let inExceptionsBlock = false;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('ExceptionsList')) {
      inExceptionsBlock = true;
      continue;
    }

    if (inExceptionsBlock) {
      if (line === '}') {
        inExceptionsBlock = false;
        continue;
      }
      const exceptionMatch = line.match(/^\d+\s*:\s*(.+)$/);
      if (exceptionMatch?.[1]) {
        exceptions.push(exceptionMatch[1].trim());
      }
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/);
    if (kvMatch) {
      values[kvMatch[1]] = kvMatch[2].trim();
    }
  }

  const httpProxy = values.HTTPEnable === '1' && values.HTTPProxy && values.HTTPPort
    ? normalizeProxyServer(`${values.HTTPProxy}:${values.HTTPPort}`)
    : '';
  const httpsProxy = values.HTTPSEnable === '1' && values.HTTPSProxy && values.HTTPSPort
    ? normalizeProxyServer(`${values.HTTPSProxy}:${values.HTTPSPort}`)
    : '';
  const socksProxy = values.SOCKSEnable === '1' && values.SOCKSProxy && values.SOCKSPort
    ? normalizeProxyServer(`socks5://${values.SOCKSProxy}:${values.SOCKSPort}`)
    : '';

  return {
    httpProxy,
    httpsProxy,
    allProxy: socksProxy || httpsProxy || httpProxy,
    bypassRules: exceptions.length > 0 ? exceptions.join(',') : trimValue(fallbackBypassRules),
  };
}

export function resolveInheritedProxySettings(options: ProxyResolutionOptions = {}): ResolvedProxySettings {
  const env = options.env ?? process.env;
  const fallbackBypassRules = trimValue(options.fallbackBypassRules);
  const envResolved = resolveProxySettingsFromEnv(env, fallbackBypassRules);
  if (hasAnyProxy(envResolved)) {
    return envResolved;
  }

  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') {
    try {
      const output = options.systemProxyOutput
        ?? execFileSync('scutil', ['--proxy'], { encoding: 'utf8' });
      const parsed = parseMacSystemProxyOutput(output, fallbackBypassRules);
      if (hasAnyProxy(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore system proxy lookup failures and fall back to direct.
    }
  }

  return {
    httpProxy: '',
    httpsProxy: '',
    allProxy: '',
    bypassRules: fallbackBypassRules,
  };
}

export function resolveEffectiveProxySettings(
  settings: ProxySettings,
  options: ProxyResolutionOptions = {},
): ResolvedProxySettings {
  if (settings.proxyEnabled) {
    return resolveProxySettings(settings);
  }
  return resolveInheritedProxySettings({
    ...options,
    fallbackBypassRules: options.fallbackBypassRules ?? settings.proxyBypassRules,
  });
}

export function buildElectronProxyConfig(
  settings: ProxySettings,
  options: ProxyResolutionOptions = {},
): ElectronProxyConfig {
  const resolved = resolveEffectiveProxySettings(settings, options);
  if (!hasAnyProxy(resolved)) {
    return { mode: 'direct' };
  }
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

export function buildProxyEnv(
  settings: ProxySettings,
  options: ProxyResolutionOptions = {},
): Record<string, string> {
  const blank = {
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: '',
    NO_PROXY: '',
    no_proxy: '',
  };

  const resolved = resolveEffectiveProxySettings(settings, options);
  if (!hasAnyProxy(resolved)) {
    return blank;
  }
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
