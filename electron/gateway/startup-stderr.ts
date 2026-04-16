export type GatewayStderrClassification = {
  level: 'drop' | 'debug' | 'warn';
  normalized: string;
};

const MAX_STDERR_LINES = 120;

export function classifyGatewayStderrMessage(message: string): GatewayStderrClassification {
  const msg = normalizeGatewayStderrMessage(message);
  if (!msg) {
    return { level: 'drop', normalized: msg };
  }

  // Known noisy lines that are not actionable for Gateway lifecycle debugging.
  if (msg.includes('openclaw-control-ui') && msg.includes('token_mismatch')) {
    return { level: 'drop', normalized: msg };
  }
  if (msg.includes('closed before connect') && msg.includes('token mismatch')) {
    return { level: 'drop', normalized: msg };
  }
  if (msg.includes('[ws] closed before connect') && msg.includes('code=1005')) {
    return { level: 'debug', normalized: msg };
  }
  if (
    msg.includes('[ws] closed before connect')
    && msg.includes('code=1006')
    && (msg.includes('remote=127.0.0.1') || msg.includes('peer=127.0.0.1'))
  ) {
    return { level: 'debug', normalized: msg };
  }
  if (msg.includes('security warning: dangerous config flags enabled')) {
    return { level: 'debug', normalized: msg };
  }
  if (msg.includes('[whatsapp] No messages received in 30m - restarting connection')) {
    return { level: 'debug', normalized: msg };
  }
  if (msg.includes('[whatsapp] Web connection closed (status 499)')) {
    return { level: 'debug', normalized: msg };
  }
  if (
    msg.includes('[whatsapp]')
    && msg.includes('channel exited:')
    && (
      msg.includes('[details unavailable from upstream logger]')
      || msg.includes('statusCode":408')
      || msg.includes('"code":"ECONNRESET"')
      || msg.includes('Request Time-out')
    )
  ) {
    return { level: 'debug', normalized: msg };
  }
  if (msg.includes('[bonjour] watchdog detected non-announced service')) {
    return { level: 'debug', normalized: msg };
  }
  if (msg.includes('[bonjour] restarting advertiser')) {
    return { level: 'debug', normalized: msg };
  }
  if (msg.includes('[bonjour] gateway name conflict resolved')) {
    return { level: 'debug', normalized: msg };
  }
  if (msg.includes('[bonjour] gateway hostname conflict resolved')) {
    return { level: 'debug', normalized: msg };
  }

  // Downgrade frequent non-fatal noise.
  if (msg.includes('ExperimentalWarning')) return { level: 'debug', normalized: msg };
  if (msg.includes('DeprecationWarning')) return { level: 'debug', normalized: msg };
  if (msg.includes('Debugger attached')) return { level: 'debug', normalized: msg };

  // Gateway config warnings (e.g. stale plugin entries) are informational, not actionable.
  if (msg.includes('Config warnings:')) return { level: 'debug', normalized: msg };

  // Electron restricts NODE_OPTIONS in packaged apps; this is expected and harmless.
  if (msg.includes('node: --require is not allowed in NODE_OPTIONS')) {
    return { level: 'debug', normalized: msg };
  }

  return { level: 'warn', normalized: msg };
}

function normalizeGatewayStderrMessage(message: string): string {
  const msg = message.trim();
  if (!msg) return msg;

  if (msg.includes('channel exited: [object Object]')) {
    return msg.replace(
      'channel exited: [object Object]',
      'channel exited: [details unavailable from upstream logger]',
    );
  }

  return msg;
}

export function recordGatewayStartupStderrLine(lines: string[], line: string): void {
  const normalized = line.trim();
  if (!normalized) return;
  lines.push(normalized);
  if (lines.length > MAX_STDERR_LINES) {
    lines.splice(0, lines.length - MAX_STDERR_LINES);
  }
}
