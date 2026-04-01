import electronBinaryPath from 'electron';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');
const screenshotRoot = join(repoRoot, 'resources/screenshot');
const WINDOW_WIDTH = 1392;
const WINDOW_HEIGHT = 912;

const locales = [
  {
    code: 'en',
    label: 'English',
    dir: 'en',
    titles: {
      channels: 'Messaging Channels',
      skills: 'Skills',
      cron: 'Scheduled Tasks',
    },
  },
  {
    code: 'zh',
    label: '中文',
    dir: 'zh',
    titles: {
      channels: '消息频道',
      skills: '技能',
      cron: '定时任务',
    },
  },
  {
    code: 'ja',
    label: '日本語',
    dir: 'jp',
    titles: {
      channels: 'メッセージングチャンネル',
      skills: 'スキル',
      cron: '定期タスク',
    },
  },
];

async function allocatePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function launchInvestClaw(homeDir, userDataDir) {
  const hostApiPort = await allocatePort();
  const electronEnv = process.platform === 'linux'
    ? { ELECTRON_DISABLE_SANDBOX: '1' }
    : {};

  return await electron.launch({
    executablePath: electronBinaryPath,
    args: [electronEntry],
    env: {
      ...process.env,
      ...electronEnv,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(homeDir, '.config'),
      INVESTCLAW_E2E: '1',
      INVESTCLAW_USER_DATA_DIR: userDataDir,
      INVESTCLAW_PORT_INVESTCLAW_HOST_API: String(hostApiPort),
    },
    timeout: 90_000,
  });
}

async function setWindowSize(electronApp) {
  await electronApp.evaluate(({ BrowserWindow }, { width, height }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.setBounds({ width, height });
    win.center();
  }, { width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
}

async function waitForHeading(page, title) {
  await page.getByRole('heading', { name: title, exact: true }).waitFor({
    state: 'visible',
    timeout: 30_000,
  });
}

async function captureMainLayout(page, targetPath) {
  await page.waitForTimeout(800);
  await page.getByTestId('main-layout').screenshot({
    path: targetPath,
    type: 'png',
    animations: 'disabled',
  });
}

async function prepareLocale(page, locale) {
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('setup-page').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('button', { name: locale.label, exact: true }).click();
  await page.waitForTimeout(350);
  await page.getByTestId('setup-skip-button').click();
  await page.getByTestId('main-layout').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1_200);
}

async function generateLocaleScreenshots(locale) {
  const homeDir = await mkdtemp(join(tmpdir(), `investclaw-screenshot-home-${locale.code}-`));
  const userDataDir = await mkdtemp(join(tmpdir(), `investclaw-screenshot-user-data-${locale.code}-`));

  await mkdir(join(homeDir, '.config'), { recursive: true });
  await mkdir(join(homeDir, 'AppData', 'Local'), { recursive: true });
  await mkdir(join(homeDir, 'AppData', 'Roaming'), { recursive: true });
  await mkdir(join(screenshotRoot, locale.dir), { recursive: true });

  let electronApp;
  try {
    electronApp = await launchInvestClaw(homeDir, userDataDir);
    const page = await electronApp.firstWindow();
    await setWindowSize(electronApp);
    await prepareLocale(page, locale);

    await page.getByTestId('chat-quick-action-askQuestions').waitFor({ state: 'visible', timeout: 30_000 });
    await captureMainLayout(page, join(screenshotRoot, locale.dir, 'chat.png'));

    await page.getByTestId('sidebar-nav-models').click();
    await page.getByTestId('models-page').waitFor({ state: 'visible', timeout: 30_000 });
    await captureMainLayout(page, join(screenshotRoot, locale.dir, 'models.png'));

    await page.getByTestId('sidebar-nav-channels').click();
    await waitForHeading(page, locale.titles.channels);
    await captureMainLayout(page, join(screenshotRoot, locale.dir, 'channels.png'));

    await page.getByTestId('sidebar-nav-skills').click();
    await waitForHeading(page, locale.titles.skills);
    await captureMainLayout(page, join(screenshotRoot, locale.dir, 'skills.png'));

    await page.getByTestId('sidebar-nav-cron').click();
    await waitForHeading(page, locale.titles.cron);
    await captureMainLayout(page, join(screenshotRoot, locale.dir, 'cron.png'));

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-page').waitFor({ state: 'visible', timeout: 30_000 });
    await captureMainLayout(page, join(screenshotRoot, locale.dir, 'settings.png'));
  } finally {
    if (electronApp) {
      await electronApp.close().catch(() => {});
    }
    await rm(homeDir, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
}

async function main() {
  for (const locale of locales) {
    console.log(`Generating README screenshots for ${locale.code}...`);
    await generateLocaleScreenshots(locale);
  }
  console.log('README screenshots updated.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
