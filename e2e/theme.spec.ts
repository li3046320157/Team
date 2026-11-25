import { expect, test } from '@playwright/test';

test('登录页金币可互动、配色可切换并持久化', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('auth-page')).toBeVisible();
  await expect(page.getByTestId('auth-big-coin')).toBeVisible();
  await expect(page.getByTestId('auth-mini-coin')).toHaveCount(10);

  await page.getByTestId('auth-mini-coin').first().click({ force: true });
  await expect(page.getByText('已点亮 1 枚金币')).toBeVisible();

  await page.getByTestId('palette-ocean').click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'ocean');
  await page.reload();
  await expect(page.getByTestId('auth-page')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'ocean');
  await expect(page.getByTestId('palette-ocean')).toHaveAttribute('aria-pressed', 'true');
});