import { existsSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeAppPath = '/Users/arain/Desktop/Workplace/Claude_work/InvestClaw/dist-electron/main';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/investclaw-test-user-data',
    getAppPath: () => fakeAppPath,
  },
}));

describe('clawhub path resolution', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolves the clawhub entry script from the installed package instead of dist-electron', async () => {
    const { getClawHubCliEntryPath } = await import('@electron/utils/paths');

    const entryPath = getClawHubCliEntryPath();

    expect(entryPath.endsWith('clawdhub.js')).toBe(true);
    expect(entryPath.includes('/dist-electron/main/node_modules/')).toBe(false);
    expect(existsSync(entryPath)).toBe(true);
  });

  it('resolves the nearest node_modules .bin clawhub shim', async () => {
    const { getClawHubCliBinPath } = await import('@electron/utils/paths');

    const binPath = getClawHubCliBinPath();

    expect(binPath.includes('/dist-electron/main/node_modules/.bin/')).toBe(false);
    expect(existsSync(binPath)).toBe(true);
  });
});
