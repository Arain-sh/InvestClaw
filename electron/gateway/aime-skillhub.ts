import crypto from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import extractZip from 'extract-zip';
import { getOpenClawSkillsDir, ensureDir } from '../utils/paths';
import { logger } from '../utils/logger';
import { getSkillConfig, updateSkillConfig } from '../utils/skill-config';

export interface AimeSkillHubSearchParams {
  query?: string;
  limit?: number;
}

export interface AimeSkillHubInstallParams {
  slug: string;
  version?: string;
  force?: boolean;
}

export interface AimeSkillHubUninstallParams {
  slug: string;
}

export interface AimeSkillHubSkillResult {
  slug: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  source: 'aime-official';
  sourceLabel: 'AIME Official';
}

export interface AimeSkillHubInstalledSkillResult {
  slug: string;
  version?: string;
  source: 'aime-official';
  baseDir: string;
}

interface AimeSquareRecord {
  skill_uuid: string;
  name: string;
  description?: string | null;
  classify?: string | null;
  status?: number | null;
  storage_path?: string | null;
}

interface AimeSquarePayload {
  status_code: number;
  status_msg?: string;
  data?: {
    records?: AimeSquareRecord[];
    total_pages?: number;
  } | null;
}

interface AimeApiKeyPayload {
  status_code: number;
  status_msg?: string;
  result?: Array<{ api_key?: string | null }> | { api_key?: string | null } | null;
}

interface InstalledMarker {
  source: 'aime-official';
  slug: string;
  version: string;
  installedAt: string;
}

type HeadersWithSetCookie = Headers & {
  getSetCookie?: () => string[];
};

const AIME_REFERER = 'https://www.ainvest.com/aime/skillhub/';
const AIME_HOME = 'https://www.ainvest.com/';
const AIME_USER_AGENT = 'Mozilla/5.0';
const AIME_MARKER_NAME = '.investclaw-aime-skill.json';
const DEFAULT_AIME_BASE_URL = 'https://open.ainvest.com';
const AIME_FETCH_TIMEOUT_MS = 20_000;
const isE2EMode = process.env.INVESTCLAW_E2E === '1' || process.env.CLAWX_E2E === '1';

const E2E_OFFICIAL_SKILLS: AimeSkillHubSkillResult[] = [
  {
    slug: 'chart-visualization',
    name: 'chart-visualization',
    description: 'Render investment data into standalone HTML charts for research workflows.',
    version: '1.0.0',
    author: 'AIME Official',
    source: 'aime-official',
    sourceLabel: 'AIME Official',
  },
  {
    slug: 'crypto-comprehensive-diagnosis',
    name: 'crypto-comprehensive-diagnosis',
    description: 'Run a multi-indicator diagnosis across market data for crypto research.',
    version: '1.0.0',
    author: 'AIME Official',
    source: 'aime-official',
    sourceLabel: 'AIME Official',
  },
];

function extractVersionFromStoragePath(storagePath?: string | null): string {
  const raw = typeof storagePath === 'string' ? storagePath.trim() : '';
  if (!raw) return '1.0.0';
  const match = raw.match(/\/(\d+\.\d+\.\d+)\/[^/]+\.zip$/i);
  return match?.[1] || '1.0.0';
}

function looksLikeZipArchive(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return (
    (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04)
    || (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x05 && buffer[3] === 0x06)
    || (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x07 && buffer[3] === 0x08)
  );
}

function parseSetCookies(headers: Headers): string[] {
  const richHeaders = headers as HeadersWithSetCookie;
  if (typeof richHeaders.getSetCookie === 'function') {
    const values = richHeaders.getSetCookie();
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
  }

  const collapsed = headers.get('set-cookie');
  if (!collapsed) return [];
  return collapsed
    .split(/,(?=[^ ;]+=)/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildCookieHeader(setCookies: string[]): string {
  return setCookies
    .map((value) => value.split(';', 1)[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function mapSquareRecord(record: AimeSquareRecord): AimeSkillHubSkillResult {
  const name = (record.name || '').trim();
  return {
    slug: name,
    name,
    description: String(record.description || '').trim(),
    version: extractVersionFromStoragePath(record.storage_path),
    author: 'AIME Official',
    source: 'aime-official',
    sourceLabel: 'AIME Official',
  };
}

async function fetchAime(input: string | URL, init?: RequestInit): Promise<Response> {
  // AIME's visitor session flow depends on reading the full Set-Cookie array
  // from the login response. Node fetch exposes that consistently via
  // headers.getSetCookie(), while Electron net.fetch may collapse it.
  return await fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(AIME_FETCH_TIMEOUT_MS),
  });
}

export class AimeSkillHubService {
  private readonly skillsRoot: string;

  constructor() {
    this.skillsRoot = getOpenClawSkillsDir();
    ensureDir(this.skillsRoot);
  }

  private async createVisitorSession(): Promise<string> {
    const fingerprint = crypto.randomUUID();
    const response = await fetchAime('https://user.ainvest.com/auth/visitor/login', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/x-www-form-urlencoded',
        fingerprint,
        referer: AIME_HOME,
        'user-agent': AIME_USER_AGENT,
      },
      body: `udid=${encodeURIComponent(fingerprint)}&clientType=WEB`,
    });

    const payloadText = await response.text();
    if (!response.ok) {
      throw new Error(`AIME visitor login failed (${response.status}): ${payloadText}`);
    }

    const cookieHeader = buildCookieHeader(parseSetCookies(response.headers));
    if (!cookieHeader) {
      throw new Error('AIME visitor login did not return session cookies');
    }

    return cookieHeader;
  }

  private async fetchSquarePage(cookieHeader: string, current: number, size: number): Promise<AimeSquarePayload> {
    const url = new URL('https://tech.ainvest.com/gateway/market/api/v1/skills/square');
    url.searchParams.set('current', String(current));
    url.searchParams.set('size', String(size));
    url.searchParams.set('channel', 'iwencai');

    const response = await fetchAime(url.toString(), {
      headers: {
        accept: 'application/json, text/plain, */*',
        cookie: cookieHeader,
        referer: AIME_REFERER,
        'user-agent': AIME_USER_AGENT,
      },
    });

    const payloadText = await response.text();
    if (!response.ok) {
      throw new Error(`AIME skills square request failed (${response.status}): ${payloadText}`);
    }

    const payload = JSON.parse(payloadText) as AimeSquarePayload;
    if (payload.status_code !== 0 || !payload.data) {
      throw new Error(payload.status_msg || 'AIME official skills request failed');
    }
    return payload;
  }

  private async fetchAllOfficialRecords(): Promise<AimeSquareRecord[]> {
    if (isE2EMode) {
      return E2E_OFFICIAL_SKILLS.map((skill) => ({
        skill_uuid: skill.slug,
        name: skill.name,
        description: skill.description,
        classify: 'OFFICIAL',
        status: 3,
        storage_path: `s3:default/${skill.slug}/${skill.version}/${skill.slug}.zip`,
      }));
    }

    const cookieHeader = await this.createVisitorSession();
    const pageSize = 100;
    const firstPage = await this.fetchSquarePage(cookieHeader, 1, pageSize);
    let records = [...(firstPage.data?.records || [])];
    const totalPages = Math.max(1, Number(firstPage.data?.total_pages || 1));

    if (totalPages > 1) {
      const remainingPages = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, index) =>
          this.fetchSquarePage(cookieHeader, index + 2, pageSize),
        ),
      );
      for (const page of remainingPages) {
        records = records.concat(page.data?.records || []);
      }
    }

    return records.filter((record) => {
      const classify = String(record.classify || '').trim().toUpperCase();
      const isReady = record.status == null || Number(record.status) === 3;
      return classify === 'OFFICIAL' && isReady && String(record.name || '').trim().length > 0;
    });
  }

  private async provisionApiKey(): Promise<string | null> {
    if (isE2EMode) {
      return 'sk-e2e-aime-official-key';
    }

    const cookieHeader = await this.createVisitorSession();
    const commonHeaders = {
      accept: 'application/json, text/plain, */*',
      cookie: cookieHeader,
      referer: AIME_REFERER,
      'user-agent': AIME_USER_AGENT,
    };

    const getResponse = await fetchAime(
      'https://tech.ainvest.com/gateway/userstore/iwc/userinfo/skill/hub/v1/api/key/get/',
      { headers: commonHeaders },
    );
    const getPayload = JSON.parse(await getResponse.text()) as AimeApiKeyPayload;
    const existing = Array.isArray(getPayload.result) ? getPayload.result[0]?.api_key : null;
    if (typeof existing === 'string' && existing.trim()) {
      return existing.trim();
    }

    const addResponse = await fetchAime(
      'https://tech.ainvest.com/gateway/userstore/iwc/userinfo/skill/hub/v1/api/key/add/',
      {
        method: 'POST',
        headers: commonHeaders,
      },
    );
    const addPayload = JSON.parse(await addResponse.text()) as AimeApiKeyPayload;
    const created = !Array.isArray(addPayload.result) && addPayload.result?.api_key;
    if (typeof created === 'string' && created.trim()) {
      return created.trim();
    }

    logger.warn('AIME official API key provisioning returned no key');
    return null;
  }

  private async fetchSkillZipBuffer(slug: string): Promise<Buffer> {
    const response = await fetchAime(
      `https://tech.ainvest.com/gateway/market/api/v1/skills/square/download?name=${encodeURIComponent(slug)}`,
      {
        headers: {
          accept: '*/*',
          referer: AIME_REFERER,
          'user-agent': AIME_USER_AGENT,
        },
      },
    );

    const buffer = Buffer.from(await response.arrayBuffer());
    if (looksLikeZipArchive(buffer)) {
      return buffer;
    }

    const text = buffer.toString('utf8');
    throw new Error(`AIME official skill download failed for "${slug}": ${text}`);
  }

  private async findExtractedSkillRoot(extractRoot: string, slug: string): Promise<string> {
    const directCandidate = path.join(extractRoot, slug);
    if (existsSync(path.join(directCandidate, 'SKILL.md'))) {
      return directCandidate;
    }

    const entries = await readdir(extractRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(extractRoot, entry.name);
      if (existsSync(path.join(candidate, 'SKILL.md'))) {
        return candidate;
      }
    }

    throw new Error(`AIME official skill archive for "${slug}" does not contain SKILL.md`);
  }

  private async writeInstalledMarker(targetDir: string, slug: string, version: string): Promise<void> {
    const marker: InstalledMarker = {
      source: 'aime-official',
      slug,
      version: version || '1.0.0',
      installedAt: new Date().toISOString(),
    };
    await writeFile(path.join(targetDir, AIME_MARKER_NAME), JSON.stringify(marker, null, 2), 'utf8');
  }

  private async mergeAimeEnvIntoSkillConfig(slug: string): Promise<void> {
    const apiKey = await this.provisionApiKey();
    const existingConfig = await getSkillConfig(slug);
    const nextEnv: Record<string, string> = {
      ...(existingConfig?.env || {}),
      AIME_BASE_URL: DEFAULT_AIME_BASE_URL,
    };

    if (apiKey) {
      nextEnv.AIME_API_KEY = apiKey;
    }

    const result = await updateSkillConfig(slug, { env: nextEnv });
    if (!result.success) {
      throw new Error(result.error || `Failed to persist AIME config for ${slug}`);
    }
  }

  async search(params: AimeSkillHubSearchParams): Promise<AimeSkillHubSkillResult[]> {
    const query = String(params.query || '').trim().toLowerCase();
    const limit = Math.max(1, Number(params.limit || 50));
    const records = await this.fetchAllOfficialRecords();
    const mapped = records.map(mapSquareRecord);
    const filtered = query
      ? mapped.filter((skill) =>
          skill.name.toLowerCase().includes(query)
          || skill.description.toLowerCase().includes(query)
          || String(skill.author || '').toLowerCase().includes(query),
        )
      : mapped;
    return filtered.slice(0, limit);
  }

  async install(params: AimeSkillHubInstallParams): Promise<void> {
    const slug = String(params.slug || '').trim();
    if (!slug) {
      throw new Error('AIME official skill slug is required');
    }

    ensureDir(this.skillsRoot);
    const targetDir = path.join(this.skillsRoot, slug);
    if (existsSync(targetDir)) {
      if (!params.force) {
        throw new Error(`Target exists: ${targetDir} (use force to overwrite)`);
      }
      await rm(targetDir, { recursive: true, force: true });
    }

    const tempRoot = await mkdtemp(path.join(tmpdir(), 'investclaw-aime-'));
    try {
      const zipBuffer = await this.fetchSkillZipBuffer(slug);
      const zipPath = path.join(tempRoot, `${slug}.zip`);
      const extractRoot = path.join(tempRoot, 'extract');
      await writeFile(zipPath, zipBuffer);
      await mkdir(extractRoot, { recursive: true });
      await extractZip(zipPath, { dir: extractRoot });

      const skillRoot = await this.findExtractedSkillRoot(extractRoot, slug);
      await mkdir(targetDir, { recursive: true });
      await cp(skillRoot, targetDir, { recursive: true, force: true });

      if (!existsSync(path.join(targetDir, 'SKILL.md'))) {
        throw new Error(`Installed AIME skill "${slug}" is missing SKILL.md`);
      }

      await this.writeInstalledMarker(targetDir, slug, params.version || '1.0.0');
      await this.mergeAimeEnvIntoSkillConfig(slug);
      logger.info(`Installed AIME official skill: ${slug} -> ${targetDir}`);
    } finally {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async uninstall(params: AimeSkillHubUninstallParams): Promise<void> {
    const slug = String(params.slug || '').trim();
    if (!slug) {
      throw new Error('AIME official skill slug is required');
    }

    const targetDir = path.join(this.skillsRoot, slug);
    if (existsSync(targetDir)) {
      await rm(targetDir, { recursive: true, force: true });
    }
  }

  async listInstalled(): Promise<AimeSkillHubInstalledSkillResult[]> {
    if (!existsSync(this.skillsRoot)) {
      return [];
    }

    const entries = await readdir(this.skillsRoot, { withFileTypes: true });
    const installed: AimeSkillHubInstalledSkillResult[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const baseDir = path.join(this.skillsRoot, entry.name);
      const markerPath = path.join(baseDir, AIME_MARKER_NAME);
      if (!existsSync(markerPath)) continue;

      try {
        const parsed = JSON.parse(await readFile(markerPath, 'utf8')) as InstalledMarker;
        installed.push({
          slug: entry.name,
          version: parsed.version || '1.0.0',
          source: 'aime-official',
          baseDir,
        });
      } catch (error) {
        logger.warn(`Failed to read AIME official marker for ${entry.name}:`, error);
      }
    }

    return installed;
  }

  async isInstalled(slug: string): Promise<boolean> {
    const markerPath = path.join(this.skillsRoot, slug, AIME_MARKER_NAME);
    if (!existsSync(markerPath)) return false;
    try {
      const markerStat = await stat(markerPath);
      return markerStat.isFile();
    } catch {
      return false;
    }
  }
}
