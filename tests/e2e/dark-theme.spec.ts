import { expect, test, completeSetup } from './fixtures/electron';

function rgbTuples(value: string): Array<[number, number, number]> {
  return [...value.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)].map((match) => [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ]);
}

function hasVisibleShadow(value: string): boolean {
  return [...value.matchAll(/rgba?\(\d+,\s*\d+,\s*\d+(?:,\s*([\d.]+))?\)/g)].some(
    (match) => Number(match[1] ?? 1) > 0
  );
}

test.describe('InvestClaw dark theme', () => {
  test('uses dark large-area backgrounds', async ({ page }) => {
    await completeSetup(page);
    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await page.getByRole('button', { name: 'Dark' }).click();

    await page.evaluate(() => {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(250);

    const backgrounds = await page.evaluate(() => {
      const layout = document.querySelector('[data-testid="main-layout"]');
      const shell = document.querySelector('.app-shell-panel');
      const sidebar = document.querySelector('[data-testid="sidebar"]');
      const settingsNav = document.querySelector('[data-testid="sidebar-nav-settings"]');
      const content = document.querySelector('[data-testid="main-content"]');
      const mutedCard = document.querySelector('.page-card-muted');
      const outlineButton = [...document.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Light')
      );
      const activeThemeButton = [...document.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Dark')
      );
      const modalPanel = document.createElement('div');
      modalPanel.className = 'app-modal-panel';
      document.body.appendChild(modalPanel);
      const switchPanel = document.createElement('button');
      switchPanel.className = 'app-switch';
      switchPanel.dataset.state = 'checked';
      const switchThumb = document.createElement('span');
      switchThumb.className = 'app-switch-thumb';
      switchPanel.appendChild(switchThumb);
      document.body.appendChild(switchPanel);
      if (!layout || !shell || !sidebar || !settingsNav || !content || !mutedCard) {
        throw new Error('Expected app shell nodes to exist');
      }
      if (!outlineButton) {
        throw new Error('Expected theme outline button to exist');
      }
      if (!activeThemeButton) {
        throw new Error('Expected active theme button to exist');
      }

      return [
        getComputedStyle(document.body).backgroundImage,
        getComputedStyle(layout).backgroundImage,
        getComputedStyle(shell).backgroundImage,
        getComputedStyle(sidebar).backgroundImage,
        getComputedStyle(content).backgroundImage,
        getComputedStyle(mutedCard).backgroundColor,
        getComputedStyle(outlineButton).boxShadow,
        getComputedStyle(modalPanel).backgroundColor,
        getComputedStyle(switchPanel).backgroundColor,
        getComputedStyle(switchThumb).backgroundColor,
        getComputedStyle(settingsNav).backgroundColor,
        getComputedStyle(settingsNav).color,
        getComputedStyle(activeThemeButton).backgroundColor,
        getComputedStyle(activeThemeButton).color,
      ];
    });

    for (const background of backgrounds.slice(0, 5)) {
      const colors = rgbTuples(background);
      expect(colors.length).toBeGreaterThan(0);
      expect(colors.some(([r, g, b]) => r === 15 && g === 23 && b === 18)).toBe(true);
      for (const [r, g, b] of colors) {
        expect(Math.max(r, g, b)).toBeLessThan(90);
      }
    }

    const cardColors = rgbTuples(backgrounds[5]);
    expect(cardColors.length).toBeGreaterThan(0);
    for (const [r, g, b] of cardColors) {
      expect(Math.max(r, g, b)).toBeLessThan(50);
    }

    expect(hasVisibleShadow(backgrounds[6])).toBe(false);

    expect(backgrounds[7]).toBe('rgb(18, 28, 21)');
    expect(backgrounds[8]).toBe('rgb(244, 213, 134)');
    expect(backgrounds[9]).toBe('rgb(15, 23, 18)');
    expect(backgrounds[10]).toBe(backgrounds[12]);
    expect(backgrounds[11]).toBe(backgrounds[13]);
  });

  test('removes the dark composer inset highlight', async ({ page }) => {
    await completeSetup(page);
    await expect(page.getByTestId('chat-composer-card')).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(250);

    const composerShadow = await page.getByTestId('chat-composer-card').evaluate((node) =>
      getComputedStyle(node).boxShadow
    );

    expect(composerShadow).toContain('rgba(0, 0, 0');
    expect(composerShadow).not.toContain('255, 255, 255');
  });
});
