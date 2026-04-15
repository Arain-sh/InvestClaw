import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures/electron';
import { completeSetup } from './fixtures/electron';

test.describe('InvestClaw Electron smoke flows', () => {
  test('shows the setup wizard on a fresh profile', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await expect(page.getByTestId('setup-welcome-step')).toBeVisible();
    await expect(page.getByTestId('setup-skip-button')).toBeVisible();
  });

  test('can skip setup and navigate to the models page', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-nav-models').click();

    await expect(page.getByTestId('models-page')).toBeVisible();
    await expect(page.getByTestId('models-page-title')).toBeVisible();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
  });

  test('shows research quick actions on the empty chat and prefills the composer', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await expect(page.getByTestId('chat-landing-hero')).toBeVisible();
    await expect(page.getByTestId('chat-quick-action-askQuestions')).toBeVisible();

    await page.getByTestId('chat-quick-action-askQuestions').click();
    await expect(page.locator('textarea')).not.toHaveValue('');
  });

  test('shows the right-side workspace and opens nested files from the current agent workspace', async ({ homeDir, launchElectronApp }) => {
    const workspaceRoot = join(homeDir, '.openclaw', 'workspace');
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true });
    await writeFile(join(workspaceRoot, 'research-note.md'), '# Research Note\n\n- NVDA\n- TSMC\n');
    await writeFile(join(workspaceRoot, 'notes', 'valuation.txt'), 'DCF assumptions go here.\nTerminal growth: 3%.');

    const electronApp = await launchElectronApp();
    try {
      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await completeSetup(page);

      await expect(page.getByTestId('chat-workspace-panel')).toBeVisible();
      await expect(page.getByTestId('main-content')).toHaveJSProperty('scrollTop', 0);
      const hasOuterVerticalOverflow = await page.getByTestId('main-content').evaluate((node) => {
        const element = node as HTMLElement;
        const computed = window.getComputedStyle(element);
        const doc = document.documentElement;
        return {
          overflowY: computed.overflowY,
          docHasVerticalOverflow: doc.scrollHeight > doc.clientHeight + 1,
        };
      });
      expect(['auto', 'hidden']).toContain(hasOuterVerticalOverflow.overflowY);
      expect(hasOuterVerticalOverflow.docHasVerticalOverflow).toBe(false);

      await expect(page.getByTestId('workspace-entry-notes')).toBeVisible();
      await page.getByTestId('workspace-entry-notes').hover();

      await page.getByTestId('workspace-entry-notes').click();
      await expect(page.getByTestId('workspace-entry-notes2fvaluation.txt')).toBeVisible();

      await page.getByTestId('workspace-entry-notes2fvaluation.txt').click();
      await expect(page.getByTestId('workspace-preview-title')).toContainText('valuation.txt');
      await expect(page.getByTestId('workspace-preview')).toContainText('Terminal growth: 3%');

      await page.getByTestId('chat-toolbar-workspace-toggle').evaluate((button: HTMLElement) => button.click());
      await expect(page.getByTestId('chat-workspace-panel')).toHaveCount(0);

      await page.getByTestId('chat-toolbar-workspace-toggle').evaluate((button: HTMLElement) => button.click());
      await expect(page.getByTestId('chat-workspace-panel')).toBeVisible();
    } finally {
      await electronApp.close();
    }
  });

  test('can open the skills marketplace without showing legacy marketplace branding', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-nav-skills').click();

    await expect(page.getByTestId('skills-page')).toBeVisible();
    await expect(page.getByTestId('skills-page-title')).toBeVisible();

    await page.getByTestId('skills-open-install-button').click();
    await expect(page.getByTestId('skills-install-sheet')).toBeVisible();
    await expect(page.getByTestId('skills-marketplace-source')).toBeVisible();
    await expect(page.getByText('ClawHub')).toHaveCount(0);
  });

  test('persists skipped setup across relaunch for the same isolated profile', async ({ electronApp, launchElectronApp }) => {
    const firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');
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
