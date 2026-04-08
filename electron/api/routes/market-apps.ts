import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { launchMarketApp, listMarketApps, updateMarketApp } from '../../utils/market-apps';

export async function handleMarketAppRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/market-apps' && req.method === 'GET') {
    try {
      const snapshot = await listMarketApps();
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/market-apps/') && req.method === 'PUT') {
    const suffix = url.pathname.slice('/api/market-apps/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const appId = decodeURIComponent(parts[0]);
        const body = await parseJsonBody<{ customPath?: string; pinned?: boolean }>(req);
        const descriptor = await updateMarketApp(appId, {
          customPath: body.customPath,
          pinned: body.pinned,
        });
        sendJson(res, 200, { success: true, app: descriptor });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  if (url.pathname.startsWith('/api/market-apps/') && req.method === 'POST') {
    const suffix = url.pathname.slice('/api/market-apps/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 2 && parts[1] === 'launch') {
      try {
        const appId = decodeURIComponent(parts[0]);
        const descriptor = await launchMarketApp(appId);
        sendJson(res, 200, { success: true, app: descriptor });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  return false;
}
