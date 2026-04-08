import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureSetupPage, expect, navigateToHash, test } from './fixtures/electron';

test.describe('InvestClaw Electron smoke flows', () => {
  test('shows the setup wizard on a fresh profile', async ({ page }) => {
    await ensureSetupPage(page);
    await expect(page.getByTestId('setup-welcome-step')).toBeVisible();
    await expect(page.getByTestId('setup-skip-button')).toBeVisible();
  });

  test('can skip setup and navigate to the models page', async ({ page }) => {
    await ensureSetupPage(page);
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await expect(page.getByTestId('chat-page')).toBeVisible();
    await navigateToHash(page, '#/models');

    await expect(page.getByTestId('models-page')).toBeVisible();
    await expect(page.getByTestId('models-page-title')).toBeVisible();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
  });

  test('shows research quick actions on the empty chat and prefills the composer', async ({ page }) => {
    await ensureSetupPage(page);
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await expect(page.locator('textarea')).toBeDisabled();
    await expect(page.getByTestId('chat-quick-action-askQuestions')).toBeVisible();

    await page.getByTestId('chat-quick-action-askQuestions').click();
    await expect(page.locator('textarea')).not.toHaveValue('');
  });

  test('shows the gateway disconnected composer state after setup skip', async ({ page }) => {
    await ensureSetupPage(page);
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('chat-page')).toBeVisible();
    await expect(page.locator('textarea')).toBeDisabled();
    await expect(page.locator('textarea')).toHaveAttribute('placeholder', /网关未连接/);
  });

  test('shows the unified investment workbench inside chat with adaptive files, apps, and browser views', async ({ page, homeDir }) => {
    const mainWorkspaceDir = join(homeDir, '.openclaw', 'workspace');
    await mkdir(mainWorkspaceDir, { recursive: true });
    await mkdir(join(mainWorkspaceDir, 'research', 'q1'), { recursive: true });
    await writeFile(join(mainWorkspaceDir, 'research', 'q1', 'THESIS.md'), '# Desk Panel\n\nWorkspace preview from chat.\n');
    await writeFile(
      join(mainWorkspaceDir, 'research', 'q1', 'pitch.html'),
      '<!doctype html><html><body><main style="width: 1200px; padding: 24px; border-radius: 24px; background: linear-gradient(135deg, #e0f2fe, #fef3c7);"><h1>Pitch Room</h1><p>HTML preview is live.</p></main></body></html>',
    );
    await writeFile(
      join(mainWorkspaceDir, 'research', 'q1', 'SignalCard.tsx'),
      'export default function SignalCard() { return <section style={{ width: 1180, padding: 24, borderRadius: 24, background: "linear-gradient(135deg, #ecfccb, #dbeafe)" }}><h2>Momentum Signal</h2><p>TSX preview is live.</p></section>; }\n',
    );

    await ensureSetupPage(page);
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('chat-page')).toBeVisible();
    await expect(page.getByTestId('chat-research-desk')).toBeVisible();
    await expect(page.getByTestId('chat-desk-resizer')).toBeVisible();
    await expect(page.getByTestId('chat-desk-view-switcher')).toBeVisible();
    await expect(page.getByTestId('chat-desk-view-files')).toBeVisible();
    await expect(page.getByTestId('chat-desk-view-apps')).toBeVisible();
    await expect(page.getByTestId('chat-desk-view-browser')).toBeVisible();
    await expect(page.getByTestId('chat-desk-files-surface')).toBeVisible();
    await expect
      .poll(async () => {
        return await page
          .getByTestId('chat-desk-view-switcher')
          .evaluate((element) => Math.round(element.getBoundingClientRect().height));
      })
      .toBeLessThan(48);

    await expect
      .poll(async () => {
        const [deskHeight, filesHeight] = await Promise.all([
          page.getByTestId('chat-research-desk').evaluate((element) => element.getBoundingClientRect().height),
          page.getByTestId('chat-desk-files-surface').evaluate((element) => element.getBoundingClientRect().height),
        ]);
        return Math.round((filesHeight / deskHeight) * 100);
      })
      .toBeGreaterThan(68);

    await page.getByTestId('chat-desk-folder-research').click();
    await page.getByTestId('chat-desk-folder-q1').click();
    await expect(page.getByTestId('chat-desk-preview-empty-state')).toBeVisible();

    await page.getByTestId('chat-desk-file-THESIS.md').click();
    await expect(page.getByTestId('chat-desk-preview')).toContainText('Desk Panel');
    await expect(page.getByTestId('chat-desk-preview')).toContainText('/workspace/research/q1/THESIS.md');

    await page.getByTestId('chat-desk-file-pitch.html').click();
    await expect(page.getByTestId('chat-desk-preview-mode-render')).toBeVisible();
    await expect(page.frameLocator('[data-testid="chat-desk-html-preview"]').getByText('Pitch Room')).toBeVisible();
    await expect
      .poll(async () => {
        return await page
          .frameLocator('[data-testid="chat-desk-html-preview"]')
          .locator('html')
          .evaluate((element) => {
            const root = element.ownerDocument.getElementById('investclaw-preview-root');
            if (!root) return 9999;
            return Math.max(0, Math.round(root.getBoundingClientRect().right - window.innerWidth));
          });
      })
      .toBeLessThan(6);

    await page.getByTestId('chat-desk-file-SignalCard.tsx').click();
    await expect(page.getByTestId('chat-desk-component-preview')).toContainText('Momentum Signal');
    await expect(page.getByTestId('chat-desk-component-preview')).toContainText('TSX preview is live.');
    await expect
      .poll(async () => {
        return await page.getByTestId('chat-desk-component-preview-shell').evaluate((element) => {
          return Math.round(element.scrollWidth - element.clientWidth);
        });
      })
      .toBeLessThan(6);

    await page.getByTestId('chat-desk-view-apps').click();
    await expect(page.getByTestId('chat-market-apps-surface')).toBeVisible();
    await expect(page.getByTestId('chat-market-app-dock-shell')).toBeVisible();
    await expect(page.getByTestId('chat-market-app-quick-rail')).toBeVisible();
    await expect(page.getByTestId('chat-market-app-card-tradingview')).toBeVisible();
    await expect(page.getByTestId('chat-market-app-embed-empty')).toBeVisible();

    await page.getByTestId('chat-market-app-quick-switch-tradingview').click();
    await expect(page.getByTestId('chat-market-app-inspector-tradingview')).toBeVisible();
    await expect(page.getByTestId('chat-market-app-embed-surface')).toBeVisible();
    await expect(page.getByTestId('chat-market-app-native-shell')).toBeVisible();
    await expect(page.getByTestId('chat-market-app-command-strip')).toBeVisible();
    await expect(page.getByTestId('chat-market-app-ai-deck')).toBeVisible();
    await expect(page.getByTestId('chat-market-app-native-canvas')).toBeVisible();
    await expect(page.getByTestId('chat-market-app-embed-title')).toContainText('TradingView');
    await expect(page.getByTestId('chat-market-app-embedded-webview')).toHaveCount(1);
    await page.getByTestId('chat-market-app-ai-action-pulse').click();
    await expect(page.locator('textarea')).toHaveValue(/TradingView|市场脉冲|market pulse/i);
    await expect
      .poll(async () => {
        const [dockWidth, embedWidth] = await Promise.all([
          page.getByTestId('chat-market-apps-surface').evaluate((element) => Math.round(element.getBoundingClientRect().width)),
          page.getByTestId('chat-market-app-embed-surface').evaluate((element) => Math.round(element.getBoundingClientRect().width)),
        ]);
        return embedWidth - dockWidth;
      })
      .toBeGreaterThan(55);
    await expect
      .poll(async () => {
        const [surfaceHeight, canvasHeight] = await Promise.all([
          page.getByTestId('chat-market-app-embed-surface').evaluate((element) => Math.round(element.getBoundingClientRect().height)),
          page.getByTestId('chat-market-app-native-canvas').evaluate((element) => Math.round(element.getBoundingClientRect().height)),
        ]);
        return Math.round((canvasHeight / surfaceHeight) * 100);
      })
      .toBeGreaterThan(63);

    await page.getByTestId('chat-desk-view-browser').click();
    await expect(page.getByTestId('chat-desk-browser-surface')).toBeVisible();
    await page.getByTestId('chat-desk-browser-link-tradingview').click();
    await expect(page.getByTestId('chat-desk-browser-url')).toHaveValue(/tradingview/i);
    await expect(page.getByTestId('chat-desk-browser-webview')).toHaveCount(1);
    await expect(page.getByTestId('chat-desk-browser-tabs').locator('[data-testid="chat-desk-browser-tab"]')).toHaveCount(1);
    await page.getByTestId('chat-desk-browser-new-tab').click();
    await expect(page.getByTestId('chat-desk-browser-tabs').locator('[data-testid="chat-desk-browser-tab"]')).toHaveCount(2);
    await expect(page.getByTestId('chat-desk-browser-surface')).toBeVisible();
    await expect(page.getByTestId('chat-desk-browser-webview')).toHaveCount(1);

    const deskWidthBeforeResize = await page.getByTestId('chat-desk-container').evaluate((element) => Math.round(element.getBoundingClientRect().width));
    const resizerBox = await page.getByTestId('chat-desk-resizer').boundingBox();
    if (!resizerBox) {
      throw new Error('Research desk resizer is not visible');
    }
    await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizerBox.x + 120, resizerBox.y + resizerBox.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const currentWidth = await page
          .getByTestId('chat-desk-container')
          .evaluate((element) => Math.round(element.getBoundingClientRect().width));
        return Math.abs(currentWidth - deskWidthBeforeResize);
      })
      .toBeGreaterThan(8);

    const resizerBoxAfterShrink = await page.getByTestId('chat-desk-resizer').boundingBox();
    if (!resizerBoxAfterShrink) {
      throw new Error('Research desk resizer is not visible after shrink');
    }
    await page.mouse.move(resizerBoxAfterShrink.x + resizerBoxAfterShrink.width / 2, resizerBoxAfterShrink.y + resizerBoxAfterShrink.height / 2);
    await page.mouse.down();
    await page.mouse.move(36, resizerBoxAfterShrink.y + resizerBoxAfterShrink.height / 2, { steps: 14 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const [layoutWidth, deskWidth] = await Promise.all([
          page.getByTestId('chat-layout').evaluate((element) => Math.round(element.getBoundingClientRect().width)),
          page.getByTestId('chat-desk-container').evaluate((element) => Math.round(element.getBoundingClientRect().width)),
        ]);
        return Math.round((deskWidth / layoutWidth) * 100);
      })
      .toBeGreaterThan(54);

    await page.getByTestId('chat-desk-view-files').click();
    await expect(page.getByTestId('chat-desk-files-surface')).toBeVisible();
    await expect
      .poll(async () => {
        return await page.getByTestId('chat-desk-component-preview-shell').evaluate((element) => {
          return Math.round(element.scrollWidth - element.clientWidth);
        });
      })
      .toBeLessThan(6);
    await navigateToHash(page, '#/agents');
    await expect(page.getByTestId('agents-page')).toBeVisible();
  });

  test('can open the skills marketplace without showing legacy marketplace branding', async ({ page }) => {
    await ensureSetupPage(page);
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await navigateToHash(page, '#/skills');

    await expect(page.getByTestId('skills-page')).toBeVisible();
    await expect(page.getByTestId('skills-page-title')).toBeVisible();

    await page.getByTestId('skills-open-install-button').click();
    await expect(page.getByTestId('skills-install-sheet')).toBeVisible();
    await expect(page.getByTestId('skills-marketplace-source')).toBeVisible();
    await expect(page.getByTestId('skills-marketplace-source')).toContainText('AIME');
    await expect(page.getByText('ClawHub')).toHaveCount(0);
  });

  test('can create an agent with a custom workspace and preview files mapped into /workspace', async ({ page, homeDir }) => {
    const workspaceDir = join(homeDir, 'invest-workspaces', 'alpha');
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(join(workspaceDir, 'README.md'), '# Alpha Workspace\n\nContainer file browser smoke test.\n');

    await ensureSetupPage(page);
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await navigateToHash(page, '#/agents');
    await expect(page.getByTestId('agents-page')).toBeVisible();

    await page.getByTestId('agents-add-button').click();
    await expect(page.getByTestId('agents-add-dialog')).toBeVisible();
    await page.getByTestId('agents-create-name-input').fill('Alpha');
    await page.getByTestId('agents-create-workspace-input').fill(workspaceDir);
    await page.getByTestId('agents-add-save-button').click();

    await page.getByTestId('agents-card-settings-alpha').click();
    await expect(page.getByTestId('agents-settings-modal')).toBeVisible();
    await page.getByTestId('agents-workspace-tab').click();

    await expect(page.getByTestId('agents-workspace-explorer')).toBeVisible();
    await page.getByTestId('agents-workspace-file-README.md').click();
    await expect(page.getByTestId('agents-workspace-preview')).toContainText('Alpha Workspace');
    await expect(page.getByTestId('agents-workspace-preview')).toContainText('/workspace/README.md');
  });

  test('persists skipped setup across relaunch for the same isolated profile', async ({ electronApp, launchElectronApp }) => {
    const firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');
    await ensureSetupPage(firstWindow);
    await firstWindow.getByTestId('setup-skip-button').click();
    await expect(firstWindow.getByTestId('main-layout')).toBeVisible();

    await electronApp.close();

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedWindow = await relaunchedApp.firstWindow();
      await relaunchedWindow.waitForLoadState('domcontentloaded');

      await expect(relaunchedWindow.getByTestId('main-layout')).toBeVisible();
      await expect(relaunchedWindow.getByTestId('setup-page')).toHaveCount(0);
    } finally {
      await relaunchedApp.close();
    }
  });
});
