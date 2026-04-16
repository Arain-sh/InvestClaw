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
    const sidebarModelsUserSelect = await page.getByTestId('sidebar-nav-models').evaluate((node) =>
      window.getComputedStyle(node).userSelect,
    );
    expect(sidebarModelsUserSelect).toBe('none');
    await page.getByTestId('sidebar-nav-models').click();

    await expect(page.getByTestId('models-page')).toBeVisible();
    await expect(page.getByTestId('models-page-title')).toBeVisible();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
  });

  test('shows research quick actions on the empty chat and prefills the composer', async ({ page }) => {
    await completeSetup(page);
    const landingHero = page.getByTestId('chat-landing-hero');
    await expect(landingHero).toBeVisible();
    await expect(page.getByTestId('chat-quick-action-askQuestions')).toBeVisible();
    const composerCard = page.getByTestId('chat-composer-card');
    await expect(composerCard).toBeVisible();
    const composerBox = await composerCard.boundingBox();
    if (!composerBox) {
      throw new Error('composer card bounding box missing');
    }

    const textarea = page.locator('textarea');
    const focusPoints = [
      { x: composerBox.x + composerBox.width * 0.14, y: composerBox.y + composerBox.height * 0.2 },
      { x: composerBox.x + composerBox.width * 0.78, y: composerBox.y + composerBox.height * 0.22 },
      { x: composerBox.x + composerBox.width * 0.47, y: composerBox.y + composerBox.height * 0.72 },
    ];

    for (const point of focusPoints) {
      await textarea.evaluate((node: HTMLTextAreaElement) => node.blur());
      await page.mouse.click(point.x, point.y);
      await expect(textarea).toBeFocused();
    }
    const initialThinkingState = await page.getByTestId('chat-toolbar-thinking-toggle').getAttribute('aria-pressed');
    await page.getByTestId('chat-toolbar-thinking-toggle').click();
    await expect(page.getByTestId('chat-toolbar-thinking-toggle')).toHaveAttribute(
      'aria-pressed',
      initialThinkingState === 'true' ? 'false' : 'true',
    );
    await page.getByTestId('chat-toolbar-thinking-toggle').click();
    await expect(page.getByTestId('chat-toolbar-thinking-toggle')).toHaveAttribute(
      'aria-pressed',
      initialThinkingState === 'true' ? 'true' : 'false',
    );

    await page.getByTestId('chat-quick-action-askQuestions').click();
    await expect(page.locator('textarea')).not.toHaveValue('');
    await page.getByTestId('sidebar-new-chat').evaluate((button: HTMLElement) => button.click());
    await expect(page.locator('textarea')).toHaveValue('');
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
      await electronApp.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setBounds({ width: 1560, height: 1040 });
      });
      await page.waitForTimeout(250);

      await expect(page.getByTestId('chat-workspace-panel')).toBeVisible();
      await expect(page.getByTestId('chat-toolbar-workspace-toggle')).toHaveAttribute('aria-pressed', 'true');
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
      const mainPanel = page.getByTestId('chat-main-panel');
      await expect(mainPanel).toBeVisible();
      const workspacePanel = page.getByTestId('chat-workspace-panel');
      const heroHeading = page.getByTestId('chat-landing-hero').locator('h1');
      const [mainBox, workspaceBox, headingFontSize] = await Promise.all([
        mainPanel.boundingBox(),
        workspacePanel.boundingBox(),
        heroHeading.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).fontSize)),
      ]);
      expect(mainBox?.width ?? 0).toBeGreaterThan(500);
      expect(workspaceBox?.width ?? 0).toBeLessThan(mainBox?.width ?? Number.POSITIVE_INFINITY);
      expect(workspaceBox?.width ?? 0).toBeLessThan(620);
      await expect(heroHeading).toContainText(/.+/);
      expect(headingFontSize).toBeLessThan(92);

      const resizer = page.getByTestId('chat-workspace-resizer');
      const resizerBox = await resizer.boundingBox();
      if (!resizerBox) {
        throw new Error('workspace resizer bounding box missing');
      }
      await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(resizerBox.x - 180, resizerBox.y + resizerBox.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(100);
      const expandedWorkspaceBox = await workspacePanel.boundingBox();
      expect(expandedWorkspaceBox?.width ?? 0).toBeGreaterThan((workspaceBox?.width ?? 0) + 120);

      await expect(page.getByTestId('workspace-entry-notes')).toBeVisible();
      await page.getByTestId('workspace-entry-notes').hover();

      await page.getByTestId('workspace-entry-notes').click();
      await expect(page.getByTestId('workspace-entry-notes2fvaluation.txt')).toBeVisible();

      await page.getByTestId('workspace-entry-notes2fvaluation.txt').click();
      await expect(page.getByTestId('workspace-preview-title')).toContainText('valuation.txt');
      await expect(page.getByTestId('workspace-preview')).toContainText('Terminal growth: 3%');

      await page.getByTestId('chat-toolbar-workspace-toggle').evaluate((button: HTMLElement) => button.click());
      await expect(page.getByTestId('chat-workspace-panel')).toHaveCount(0);
      await expect(page.getByTestId('chat-toolbar-workspace-toggle')).toHaveAttribute('aria-pressed', 'false');

      await page.getByTestId('chat-toolbar-workspace-toggle').evaluate((button: HTMLElement) => button.click());
      await expect(page.getByTestId('chat-workspace-panel')).toBeVisible();
      await expect(page.getByTestId('chat-toolbar-workspace-toggle')).toHaveAttribute('aria-pressed', 'true');

      await electronApp.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setBounds({ width: 1180, height: 980 });
      });
      await page.waitForTimeout(300);
      await expect(page.getByTestId('chat-workspace-panel')).toBeVisible();
      await expect(page.getByTestId('workspace-close')).toHaveCount(0);
      await page.getByTestId('chat-toolbar-workspace-toggle').evaluate((button: HTMLElement) => button.click());
      await expect(page.getByTestId('chat-workspace-panel')).toHaveCount(0);
      await page.getByTestId('chat-toolbar-workspace-toggle').evaluate((button: HTMLElement) => button.click());
      await expect(page.getByTestId('chat-workspace-panel')).toBeVisible();

      await electronApp.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setBounds({ width: 920, height: 940 });
      });
      await page.waitForTimeout(300);
      await expect(page.getByTestId('chat-workspace-panel')).toBeVisible();
      await expect(page.getByTestId('chat-toolbar-thinking-toggle')).toHaveCount(0);
      await expect(page.getByTestId('chat-toolbar-workspace-toggle')).toHaveCount(0);
      await expect(page.getByTestId('workspace-close')).toBeVisible();
      await page.getByTestId('workspace-close').click();
      await expect(page.getByTestId('chat-workspace-panel')).toHaveCount(0);
      await expect(page.getByTestId('chat-toolbar-thinking-toggle')).toBeVisible();
      await expect(page.getByTestId('chat-toolbar-workspace-toggle')).toBeVisible();
      await page.getByTestId('chat-toolbar-workspace-toggle').evaluate((button: HTMLElement) => button.click());
      await expect(page.getByTestId('chat-workspace-panel')).toBeVisible();
      await page.getByTestId('workspace-overlay-backdrop').click({ position: { x: 32, y: 240 } });
      await expect(page.getByTestId('chat-workspace-panel')).toHaveCount(0);
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
