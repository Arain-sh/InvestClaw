/**
 * Dynamic imports for optional openclaw plugin-sdk subpath exports.
 *
 * openclaw is NOT in the asar's node_modules — it lives at resources/openclaw/
 * (extraResources). Static `import ... from 'openclaw/plugin-sdk/...'` would
 * produce a runtime require() that fails inside the asar.
 *
 * Instead, we create a require context from the openclaw directory itself.
 * Node.js package self-referencing allows a package to require its own exports
 * by name when the subpath still exists.
 *
 * Newer openclaw releases removed several channel-specific plugin-sdk exports
 * that InvestClaw previously used for target pickers. Those helpers are
 * optional, so we degrade gracefully to local stubs instead of crashing the
 * Electron main process on startup.
 */
import { createRequire } from 'module';
import { join } from 'node:path';
import { getOpenClawDir, getOpenClawResolvedDir } from './paths';

const _openclawPath = getOpenClawDir();
const _openclawResolvedPath = getOpenClawResolvedDir();
const _openclawSdkRequire = createRequire(join(_openclawResolvedPath, 'package.json'));
const _projectSdkRequire = createRequire(join(_openclawPath, 'package.json'));

function requireOpenClawSdk(subpath: string): Record<string, unknown> {
  try {
    return _openclawSdkRequire(subpath);
  } catch {
    return _projectSdkRequire(subpath);
  }
}

const warnedMissingSdkSubpaths = new Set<string>();

function warnMissingSdkSubpath(subpath: string, error: unknown): void {
  if (warnedMissingSdkSubpaths.has(subpath)) {
    return;
  }
  warnedMissingSdkSubpaths.add(subpath);
  console.warn(`[investclaw] Optional OpenClaw SDK export "${subpath}" is unavailable; falling back to compatibility stubs.`, error);
}

function tryRequireOpenClawSdk(subpath: string): Record<string, unknown> | null {
  try {
    return requireOpenClawSdk(subpath);
  } catch (error) {
    warnMissingSdkSubpath(subpath, error);
    return null;
  }
}

function passthroughNormalizedTarget(target: string): string | undefined {
  const trimmed = target.trim();
  return trimmed || undefined;
}

async function listNoDirectoryEntries(): Promise<unknown[]> {
  return [];
}

// --- Channel SDK dynamic imports ---
const _discordSdk = (tryRequireOpenClawSdk('openclaw/plugin-sdk/discord') ?? {
  listDiscordDirectoryGroupsFromConfig: listNoDirectoryEntries,
  listDiscordDirectoryPeersFromConfig: listNoDirectoryEntries,
  normalizeDiscordMessagingTarget: passthroughNormalizedTarget,
}) as {
  listDiscordDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listDiscordDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeDiscordMessagingTarget: (target: string) => string | undefined;
};

const _telegramSdk = (tryRequireOpenClawSdk('openclaw/plugin-sdk/telegram') ?? {
  listTelegramDirectoryGroupsFromConfig: listNoDirectoryEntries,
  listTelegramDirectoryPeersFromConfig: listNoDirectoryEntries,
  normalizeTelegramMessagingTarget: passthroughNormalizedTarget,
}) as {
  listTelegramDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listTelegramDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeTelegramMessagingTarget: (target: string) => string | undefined;
};

const _slackSdk = (tryRequireOpenClawSdk('openclaw/plugin-sdk/slack') ?? {
  listSlackDirectoryGroupsFromConfig: listNoDirectoryEntries,
  listSlackDirectoryPeersFromConfig: listNoDirectoryEntries,
  normalizeSlackMessagingTarget: passthroughNormalizedTarget,
}) as {
  listSlackDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listSlackDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeSlackMessagingTarget: (target: string) => string | undefined;
};

const _whatsappSdk = (tryRequireOpenClawSdk('openclaw/plugin-sdk/whatsapp-shared') ?? {
  normalizeWhatsAppMessagingTarget: passthroughNormalizedTarget,
}) as {
  normalizeWhatsAppMessagingTarget: (target: string) => string | undefined;
};

export const {
  listDiscordDirectoryGroupsFromConfig,
  listDiscordDirectoryPeersFromConfig,
  normalizeDiscordMessagingTarget,
} = _discordSdk;

export const {
  listTelegramDirectoryGroupsFromConfig,
  listTelegramDirectoryPeersFromConfig,
  normalizeTelegramMessagingTarget,
} = _telegramSdk;

export const {
  listSlackDirectoryGroupsFromConfig,
  listSlackDirectoryPeersFromConfig,
  normalizeSlackMessagingTarget,
} = _slackSdk;

export const { normalizeWhatsAppMessagingTarget } = _whatsappSdk;
