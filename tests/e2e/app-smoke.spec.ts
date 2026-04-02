import { expect, test } from './fixtures/electron';

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
    await expect(page.getByTestId('chat-quick-action-askQuestions')).toBeVisible();

    await page.getByTestId('chat-quick-action-askQuestions').click();
    await expect(page.locator('textarea')).not.toHaveValue('');
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
    await expect(page.getByTestId('skills-marketplace-source')).toContainText('AIME');
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
