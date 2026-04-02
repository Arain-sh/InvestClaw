import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockAppPath,
  mockIsPackaged,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockAppPath: { value: '/tmp/fake-app/dist-electron/main' },
  mockIsPackaged: { value: false },
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
  };
});

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackaged.value;
    },
    getPath: () => '/tmp/user-data',
    getAppPath: () => mockAppPath.value,
  },
}));

describe('ClawHub path resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsPackaged.value = false;
    mockAppPath.value = '/tmp/fake-app/dist-electron/main';
  });

  it('prefers the workspace node_modules path for local desktop launches', async () => {
    const workspaceEntry = path.join(process.cwd(), 'node_modules', 'clawhub', 'bin', 'clawdhub.js');
    const brokenDistEntry = path.join('/tmp/fake-app/dist-electron/main', 'node_modules', 'clawhub', 'bin', 'clawdhub.js');

    mockExistsSync.mockImplementation((target) => target === workspaceEntry);

    const { getClawHubCliEntryPath } = await import('@electron/utils/paths');
    expect(getClawHubCliEntryPath()).toBe(workspaceEntry);
    expect(getClawHubCliEntryPath()).not.toBe(brokenDistEntry);
  });

  it('prefers the workspace .bin path for local desktop launches', async () => {
    const binName = process.platform === 'win32' ? 'clawhub.cmd' : 'clawhub';
    const workspaceBin = path.join(process.cwd(), 'node_modules', '.bin', binName);
    const brokenDistBin = path.join('/tmp/fake-app/dist-electron/main', 'node_modules', '.bin', binName);

    mockExistsSync.mockImplementation((target) => target === workspaceBin);

    const { getClawHubCliBinPath } = await import('@electron/utils/paths');
    expect(getClawHubCliBinPath()).toBe(workspaceBin);
    expect(getClawHubCliBinPath()).not.toBe(brokenDistBin);
  });
});
