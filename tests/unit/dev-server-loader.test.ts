import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDevServerLoadRetryDelayMs,
  isRetryableDevServerLoadFailure,
  startDevServerLoadWithRetry,
} from '@electron/main/dev-server-loader';

class MockWebContents extends EventEmitter {
  override on(event: 'did-fail-load' | 'did-finish-load', listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  override removeListener(event: 'did-fail-load' | 'did-finish-load', listener: (...args: unknown[]) => void): this {
    return super.removeListener(event, listener);
  }
}

describe('dev server loader', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recognizes transient dev-server load failures as retryable', () => {
    expect(isRetryableDevServerLoadFailure(-324, 'ERR_EMPTY_RESPONSE')).toBe(true);
    expect(isRetryableDevServerLoadFailure(-102, 'ERR_CONNECTION_REFUSED')).toBe(true);
    expect(isRetryableDevServerLoadFailure(-300, 'ERR_INVALID_URL')).toBe(false);
  });

  it('caps retry delay growth', () => {
    expect(getDevServerLoadRetryDelayMs(1, { baseDelayMs: 200, maxDelayMs: 500 })).toBe(200);
    expect(getDevServerLoadRetryDelayMs(3, { baseDelayMs: 200, maxDelayMs: 500 })).toBe(500);
  });

  it('retries when the first dev-server load fails before the renderer is ready', async () => {
    vi.useFakeTimers();

    const url = 'http://localhost:5173/';
    const webContents = new MockWebContents();
    let loadAttempts = 0;
    const loadURL = vi.fn(async () => {
      loadAttempts += 1;
      if (loadAttempts === 1) {
        queueMicrotask(() => {
          webContents.emit('did-fail-load', {}, -324, 'ERR_EMPTY_RESPONSE', url, true);
        });
        throw new Error(`ERR_EMPTY_RESPONSE (-324) loading '${url}'`);
      }

      queueMicrotask(() => {
        webContents.emit('did-finish-load');
      });
    });
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const dispose = startDevServerLoadWithRetry(
      {
        isDestroyed: () => false,
        loadURL,
        webContents,
      },
      url,
      logger,
      { baseDelayMs: 10, maxDelayMs: 10, maxRetries: 3 },
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(loadURL).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    await Promise.resolve();

    expect(loadURL).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();

    dispose();
  });

  it('serializes retries so a stale failed load cannot trigger an endless retry loop', async () => {
    vi.useFakeTimers();

    const url = 'http://localhost:5173/';
    const webContents = new MockWebContents();
    let loadAttempts = 0;
    const loadURL = vi.fn(() => {
      loadAttempts += 1;

      if (loadAttempts === 1) {
        queueMicrotask(() => {
          webContents.emit('did-fail-load', {}, -324, 'ERR_EMPTY_RESPONSE', url, true);
        });

        return new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`ERR_EMPTY_RESPONSE (-324) loading '${url}'`));
          }, 30);
        });
      }

      queueMicrotask(() => {
        webContents.emit('did-finish-load');
      });
      return Promise.resolve();
    });
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const dispose = startDevServerLoadWithRetry(
      {
        isDestroyed: () => false,
        loadURL,
        webContents,
      },
      url,
      logger,
      { baseDelayMs: 10, maxDelayMs: 10, maxRetries: 3 },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(loadURL).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(loadURL).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    await Promise.resolve();
    expect(loadURL).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    await Promise.resolve();
    expect(loadURL).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(loadURL).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();

    dispose();
  });
});
