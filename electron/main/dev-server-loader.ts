export interface DevServerLoadRetryLogger {
  debug(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

type DidFailLoadListener = (
  event: unknown,
  errorCode: number,
  errorDescription: string,
  validatedURL: string,
  isMainFrame: boolean,
) => void;

export interface DevServerLoadTarget {
  isDestroyed(): boolean;
  loadURL(url: string): Promise<unknown>;
  webContents: {
    on(event: 'did-fail-load', listener: DidFailLoadListener): void;
    on(event: 'did-finish-load', listener: () => void): void;
    removeListener(event: 'did-fail-load', listener: DidFailLoadListener): void;
    removeListener(event: 'did-finish-load', listener: () => void): void;
  };
}

export interface DevServerLoadRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const RETRYABLE_ERROR_CODES = new Set([
  -324, // ERR_EMPTY_RESPONSE
  -118, // ERR_CONNECTION_TIMED_OUT
  -106, // ERR_INTERNET_DISCONNECTED
  -105, // ERR_NAME_NOT_RESOLVED
  -102, // ERR_CONNECTION_REFUSED
  -101, // ERR_CONNECTION_RESET
  -100, // ERR_CONNECTION_CLOSED
]);

const RETRYABLE_ERROR_NAMES = [
  'ERR_EMPTY_RESPONSE',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
];

const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 1500;
const DEFAULT_MAX_RETRIES = 12;

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') || parsed.origin;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

function parseLoadError(error: unknown): { code: number | null; description: string } | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const match = error.message.match(/(ERR_[A-Z_]+)(?:\s*\((-?\d+)\))?/);
  if (!match) {
    return null;
  }

  return {
    description: match[1],
    code: match[2] ? Number(match[2]) : null,
  };
}

export function isRetryableDevServerLoadFailure(errorCode: number, errorDescription: string): boolean {
  const normalizedDescription = errorDescription.trim().toUpperCase();
  return RETRYABLE_ERROR_CODES.has(errorCode)
    || RETRYABLE_ERROR_NAMES.some(name => normalizedDescription.includes(name));
}

export function getDevServerLoadRetryDelayMs(
  attempt: number,
  options: Pick<DevServerLoadRetryOptions, 'baseDelayMs' | 'maxDelayMs'> = {},
): number {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  return Math.min(baseDelayMs * Math.max(attempt, 1), maxDelayMs);
}

export function startDevServerLoadWithRetry(
  target: DevServerLoadTarget,
  url: string,
  logger: DevServerLoadRetryLogger,
  options: DevServerLoadRetryOptions = {},
): () => void {
  const normalizedTargetUrl = normalizeUrl(url);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearRetryTimer = (): void => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const attemptLoad = async (): Promise<void> => {
    if (disposed || target.isDestroyed()) {
      return;
    }

    try {
      await target.loadURL(url);
    } catch (error) {
      const parsed = parseLoadError(error);
      if (parsed && isRetryableDevServerLoadFailure(parsed.code ?? 0, parsed.description)) {
        logger.debug(
          `Renderer dev server load rejected before ready (${parsed.description}${parsed.code !== null ? ` ${parsed.code}` : ''})`,
        );
        scheduleRetry(parsed.code ?? 0, parsed.description);
        return;
      }

      logger.error(`Renderer load failed for ${url}`, error);
    }
  };

  const scheduleRetry = (errorCode: number, errorDescription: string): void => {
    if (disposed || target.isDestroyed()) {
      return;
    }

    if (!isRetryableDevServerLoadFailure(errorCode, errorDescription)) {
      return;
    }

    if (retryTimer) {
      return;
    }

    if (retryCount >= maxRetries) {
      logger.error(
        `Renderer dev server still unavailable after ${retryCount} retries (${errorDescription || errorCode})`,
      );
      return;
    }

    retryCount += 1;
    const delayMs = getDevServerLoadRetryDelayMs(retryCount, options);
    logger.warn(
      `Renderer dev server not ready (${errorDescription || errorCode}); retrying in ${delayMs}ms (${retryCount}/${maxRetries})`,
    );
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void attemptLoad();
    }, delayMs);
  };

  const handleDidFailLoad: DidFailLoadListener = (
    _event,
    errorCode,
    errorDescription,
    validatedURL,
    isMainFrame,
  ) => {
    if (!isMainFrame || normalizeUrl(validatedURL) !== normalizedTargetUrl) {
      return;
    }

    scheduleRetry(errorCode, errorDescription);
  };

  const handleDidFinishLoad = (): void => {
    retryCount = 0;
    clearRetryTimer();
    logger.debug(`Renderer dev server loaded successfully: ${url}`);
  };

  target.webContents.on('did-fail-load', handleDidFailLoad);
  target.webContents.on('did-finish-load', handleDidFinishLoad);

  void attemptLoad();

  return () => {
    disposed = true;
    clearRetryTimer();
    target.webContents.removeListener('did-fail-load', handleDidFailLoad);
    target.webContents.removeListener('did-finish-load', handleDidFinishLoad);
  };
}
