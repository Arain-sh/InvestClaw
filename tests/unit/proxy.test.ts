import { describe, expect, it } from 'vitest';
import {
  buildElectronProxyConfig,
  buildGatewayProxyEnv,
  buildProxyEnv,
  buildProxyEnvFromResolved,
  normalizeProxyServer,
  parseMacSystemProxySettings,
  resolveProxySettings,
} from '@electron/utils/proxy';

describe('proxy helpers', () => {
  it('normalizes bare host:port values to http URLs', () => {
    expect(normalizeProxyServer('127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
  });

  it('preserves explicit proxy schemes', () => {
    expect(normalizeProxyServer('socks5://127.0.0.1:7891')).toBe('socks5://127.0.0.1:7891');
  });

  it('falls back to the base proxy server when advanced fields are empty', () => {
    expect(resolveProxySettings({
      proxyEnabled: true,
      proxyServer: '127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>',
    })).toEqual({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7890',
      allProxy: 'http://127.0.0.1:7890',
      bypassRules: '<local>',
    });
  });

  it('uses advanced overrides when provided', () => {
    expect(resolveProxySettings({
      proxyEnabled: true,
      proxyServer: 'http://127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: 'http://127.0.0.1:7892',
      proxyAllServer: 'socks5://127.0.0.1:7891',
      proxyBypassRules: '',
    })).toEqual({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7892',
      allProxy: 'socks5://127.0.0.1:7891',
      bypassRules: '',
    });
  });

  it('keeps blank advanced fields aligned with the base proxy server', () => {
    expect(resolveProxySettings({
      proxyEnabled: true,
      proxyServer: 'http://127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: 'http://127.0.0.1:7892',
      proxyAllServer: '',
      proxyBypassRules: '',
    })).toEqual({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7892',
      allProxy: 'http://127.0.0.1:7890',
      bypassRules: '',
    });
  });

  it('follows the system Electron proxy when app proxy is disabled', () => {
    expect(buildElectronProxyConfig({
      proxyEnabled: false,
      proxyServer: '127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>',
    })).toEqual({ mode: 'system' });
  });

  it('builds protocol-specific Electron rules when proxy is enabled', () => {
    expect(buildElectronProxyConfig({
      proxyEnabled: true,
      proxyServer: 'http://127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: 'http://127.0.0.1:7892',
      proxyAllServer: 'socks5://127.0.0.1:7891',
      proxyBypassRules: '<local>;localhost',
    })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http=http://127.0.0.1:7890;https=http://127.0.0.1:7892;socks5://127.0.0.1:7891',
      proxyBypassRules: '<local>;localhost',
    });
  });

  it('builds upper and lower-case proxy env vars for the Gateway', () => {
    expect(buildProxyEnv({
      proxyEnabled: true,
      proxyServer: 'http://127.0.0.1:7890',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: 'socks5://127.0.0.1:7891',
      proxyBypassRules: '<local>;localhost\n127.0.0.1',
    })).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      ALL_PROXY: 'socks5://127.0.0.1:7891',
      http_proxy: 'http://127.0.0.1:7890',
      https_proxy: 'http://127.0.0.1:7890',
      all_proxy: 'socks5://127.0.0.1:7891',
      NO_PROXY: '<local>,localhost,127.0.0.1',
      no_proxy: '<local>,localhost,127.0.0.1',
    });
  });

  it('parses macOS system proxy settings from scutil output', () => {
    expect(parseMacSystemProxySettings(`
<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : localhost
    2 : *.local
  }
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7897
  SOCKSProxy : 127.0.0.1
}
`)).toEqual({
      httpProxy: 'http://127.0.0.1:7897',
      httpsProxy: 'http://127.0.0.1:7897',
      allProxy: 'socks5://127.0.0.1:7897',
      bypassRules: '127.0.0.1;localhost;*.local',
    });
  });

  it('prefers inherited proxy env when app proxy is disabled', async () => {
    await expect(buildGatewayProxyEnv({
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>',
    }, {
      inheritedEnv: {
        HTTPS_PROXY: 'http://127.0.0.1:7897',
        HTTP_PROXY: 'http://127.0.0.1:7897',
        NO_PROXY: 'localhost,127.0.0.1',
      },
    })).resolves.toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7897',
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      ALL_PROXY: '',
      http_proxy: 'http://127.0.0.1:7897',
      https_proxy: 'http://127.0.0.1:7897',
      all_proxy: '',
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: 'localhost,127.0.0.1',
    });
  });

  it('falls back to system proxy for the Gateway when app proxy is disabled', async () => {
    const systemProxy = buildProxyEnvFromResolved({
      httpProxy: 'http://127.0.0.1:7897',
      httpsProxy: 'http://127.0.0.1:7897',
      allProxy: 'socks5://127.0.0.1:7897',
      bypassRules: '<local>;localhost;127.0.0.1',
    });

    await expect(buildGatewayProxyEnv({
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>',
    }, {
      inheritedEnv: {},
      systemProxySettings: {
        httpProxy: 'http://127.0.0.1:7897',
        httpsProxy: 'http://127.0.0.1:7897',
        allProxy: 'socks5://127.0.0.1:7897',
        bypassRules: '<local>;localhost;127.0.0.1',
      },
    })).resolves.toEqual(systemProxy);
  });
});
