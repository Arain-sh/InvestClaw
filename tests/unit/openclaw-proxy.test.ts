import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  readOpenClawConfigMock,
  writeOpenClawConfigMock,
  withConfigLockMock,
  resolveEffectiveProxySettingsMock,
} = vi.hoisted(() => ({
  readOpenClawConfigMock: vi.fn(),
  writeOpenClawConfigMock: vi.fn(),
  withConfigLockMock: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
  resolveEffectiveProxySettingsMock: vi.fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: readOpenClawConfigMock,
  writeOpenClawConfig: writeOpenClawConfigMock,
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: withConfigLockMock,
}));

vi.mock('@electron/utils/proxy', () => ({
  resolveEffectiveProxySettings: resolveEffectiveProxySettingsMock,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('syncProxyConfigToOpenClaw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEffectiveProxySettingsMock.mockReturnValue({
      httpProxy: '',
      httpsProxy: '',
      allProxy: '',
      bypassRules: '',
    });
  });

  it('preserves existing telegram proxy on startup-style sync when proxy is disabled', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        telegram: {
          botToken: 'token',
          proxy: 'socks5://127.0.0.1:7891',
        },
      },
    });

    const { syncProxyConfigToOpenClaw } = await import('@electron/utils/openclaw-proxy');

    await syncProxyConfigToOpenClaw({
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '',
    });

    expect(writeOpenClawConfigMock).not.toHaveBeenCalled();
  });

  it('clears telegram proxy when explicitly requested while proxy is disabled', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        telegram: {
          botToken: 'token',
          proxy: 'socks5://127.0.0.1:7891',
        },
      },
    });

    const { syncProxyConfigToOpenClaw } = await import('@electron/utils/openclaw-proxy');

    await syncProxyConfigToOpenClaw({
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '',
    }, {
      preserveExistingWhenDisabled: false,
    });

    expect(writeOpenClawConfigMock).toHaveBeenCalledTimes(1);
    const updatedConfig = writeOpenClawConfigMock.mock.calls[0][0] as {
      channels: { telegram: Record<string, unknown> };
    };
    expect(updatedConfig.channels.telegram.proxy).toBeUndefined();
  });

  it('inherits system proxy into telegram config when app proxy is disabled', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        telegram: {
          botToken: 'token',
        },
      },
    });

    resolveEffectiveProxySettingsMock.mockReturnValue({
      httpProxy: '',
      httpsProxy: 'http://127.0.0.1:7897',
      allProxy: '',
      bypassRules: '',
    });

    const { syncProxyConfigToOpenClaw } = await import('@electron/utils/openclaw-proxy');

    await syncProxyConfigToOpenClaw({
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '',
    });

    expect(writeOpenClawConfigMock).toHaveBeenCalledTimes(1);
    const updatedConfig = writeOpenClawConfigMock.mock.calls[0][0] as {
      channels: { telegram: Record<string, unknown> };
    };
    expect(updatedConfig.channels.telegram.proxy).toBe('http://127.0.0.1:7897');
  });
});
