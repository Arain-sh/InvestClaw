import type { IncomingMessage, ServerResponse } from 'http';
import { getAllSkillConfigs, updateSkillConfig } from '../../utils/skill-config';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

type MarketplaceRouteBody = {
  query?: string;
  limit?: number;
  slug?: string;
  version?: string;
  force?: boolean;
  source?: string;
};

function dedupeMarketplaceResults<T extends { slug: string; source?: string }>(items: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = `${item.source || 'unknown'}::${item.slug}`;
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

function mergeInstalledResults<T extends { slug: string; source?: string }>(items: T[]): T[] {
  const bySlug = new Map<string, T>();
  for (const item of items) {
    const existing = bySlug.get(item.slug);
    if (!existing || item.source === 'aime-official') {
      bySlug.set(item.slug, item);
    }
  }
  return Array.from(bySlug.values());
}

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/skills/configs' && req.method === 'GET') {
    sendJson(res, 200, await getAllSkillConfigs());
    return true;
  }

  if (url.pathname === '/api/skills/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{
        skillKey: string;
        apiKey?: string;
        env?: Record<string, string>;
      }>(req);
      sendJson(res, 200, await updateSkillConfig(body.skillKey, {
        apiKey: body.apiKey,
        env: body.env,
      }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if ((url.pathname === '/api/clawhub/search' || url.pathname === '/api/skills/marketplace/search') && req.method === 'POST') {
    try {
      const body = await parseJsonBody<MarketplaceRouteBody>(req);
      const [clawHubResult, aimeResult] = await Promise.allSettled([
        ctx.clawHubService.search(body),
        ctx.aimeSkillHubService.search(body),
      ]);

      const results = dedupeMarketplaceResults([
        ...(clawHubResult.status === 'fulfilled'
          ? clawHubResult.value.map((item) => ({ ...item, source: 'clawhub', sourceLabel: 'Marketplace' }))
          : []),
        ...(aimeResult.status === 'fulfilled' ? aimeResult.value : []),
      ]).sort((left, right) => {
        if (left.source === 'aime-official' && right.source !== 'aime-official') return -1;
        if (left.source !== 'aime-official' && right.source === 'aime-official') return 1;
        return left.name.localeCompare(right.name);
      });

      if (results.length === 0 && clawHubResult.status === 'rejected' && aimeResult.status === 'rejected') {
        throw new Error(`${String(clawHubResult.reason)} | ${String(aimeResult.reason)}`);
      }

      sendJson(res, 200, {
        success: true,
        results,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if ((url.pathname === '/api/clawhub/install' || url.pathname === '/api/skills/marketplace/install') && req.method === 'POST') {
    try {
      const body = await parseJsonBody<MarketplaceRouteBody>(req);
      if (body.source === 'aime-official') {
        await ctx.aimeSkillHubService.install({
          slug: body.slug || '',
          version: body.version,
          force: body.force,
        });
      } else {
        await ctx.clawHubService.install({
          slug: body.slug || '',
          version: body.version,
          force: body.force,
        });
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if ((url.pathname === '/api/clawhub/uninstall' || url.pathname === '/api/skills/marketplace/uninstall') && req.method === 'POST') {
    try {
      const body = await parseJsonBody<MarketplaceRouteBody>(req);
      const isAimeInstalled = body.source === 'aime-official'
        || await ctx.aimeSkillHubService.isInstalled(body.slug || '');

      if (isAimeInstalled) {
        await ctx.aimeSkillHubService.uninstall({ slug: body.slug || '' });
      } else {
        await ctx.clawHubService.uninstall({ slug: body.slug || '' });
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if ((url.pathname === '/api/clawhub/list' || url.pathname === '/api/skills/marketplace/list') && req.method === 'GET') {
    try {
      const [clawHubInstalled, aimeInstalled] = await Promise.all([
        ctx.clawHubService.listInstalled(),
        ctx.aimeSkillHubService.listInstalled(),
      ]);
      sendJson(res, 200, {
        success: true,
        results: mergeInstalledResults([
          ...clawHubInstalled,
          ...aimeInstalled,
        ]),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-readme' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillReadme(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-path' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillPath(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
