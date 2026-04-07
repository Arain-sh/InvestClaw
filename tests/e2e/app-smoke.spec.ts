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
    await page.getByTestId('sidebar-nav-models').click();
    await expect
      .poll(async () => await page.evaluate(() => window.location.hash))
      .toContain('/models');

    await expect(page.getByTestId('models-page')).toBeVisible();
    await expect(page.getByTestId('models-page-title')).toBeVisible();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
  });

  test('shows research quick actions on the empty chat and prefills the composer', async ({ page }) => {
    await ensureSetupPage(page);
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await expect(page.getByTestId('chat-quick-action-askQuestions')).toBeVisible();

    await page.getByTestId('chat-quick-action-askQuestions').click();
    await expect(page.locator('textarea')).not.toHaveValue('');
  });

  test('shows the IDE-style research desk inside chat with files and browser tabs', async ({ page, homeDir }) => {
    const mainWorkspaceDir = join(homeDir, '.openclaw', 'workspace');
    await mkdir(mainWorkspaceDir, { recursive: true });
    await mkdir(join(mainWorkspaceDir, 'research', 'q1'), { recursive: true });
    await writeFile(join(mainWorkspaceDir, 'research', 'q1', 'THESIS.md'), '# Desk Panel\n\nWorkspace preview from chat.\n');

    await ensureSetupPage(page);
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('chat-page')).toBeVisible();
    await expect(page.getByTestId('chat-research-desk')).toBeVisible();
    await expect(page.getByTestId('chat-desk-tab-runtime')).toHaveCount(0);
    await expect(page.getByTestId('chat-desk-resizer')).toBeVisible();

    await page.getByTestId('chat-desk-folder-research').click();
    await page.getByTestId('chat-desk-folder-q1').click();
    await page.getByTestId('chat-desk-file-THESIS.md').click();
    await expect(page.getByTestId('chat-desk-preview')).toContainText('Desk Panel');
    await expect(page.getByTestId('chat-desk-preview')).toContainText('/workspace/research/q1/THESIS.md');

    const deskWidthBeforeResize = await page.getByTestId('chat-desk-container').evaluate((element) => Math.round(element.getBoundingClientRect().width));
    const resizerBox = await page.getByTestId('chat-desk-resizer').boundingBox();
    if (!resizerBox) {
      throw new Error('Research desk resizer is not visible');
    }
    await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizerBox.x - 120, resizerBox.y + resizerBox.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const currentWidth = await page
          .getByTestId('chat-desk-container')
          .evaluate((element) => Math.round(element.getBoundingClientRect().width));
        return Math.abs(currentWidth - deskWidthBeforeResize);
      })
      .toBeGreaterThan(8);

    await page.getByTestId('chat-desk-tab-browser').click();
    await expect(page.getByTestId('chat-desk-browser-url')).toHaveValue(/ainvest/i);
    await expect(page.getByTestId('chat-desk-browser-tabs').locator('[data-testid="chat-desk-browser-tab"]')).toHaveCount(1);
    await page.getByTestId('chat-desk-browser-new-tab').click();
    await expect(page.getByTestId('chat-desk-browser-tabs').locator('[data-testid="chat-desk-browser-tab"]')).toHaveCount(2);
    await expect(page.getByTestId('chat-desk-browser-surface')).toBeVisible();
    await expect(page.getByTestId('chat-desk-browser-webview')).toHaveCount(1);

    await page.getByTestId('chat-desk-tab-files').click();
    await page.getByTestId('sidebar-nav-agents').click();
    await expect
      .poll(async () => await page.evaluate(() => window.location.hash))
      .toContain('/agents');
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
