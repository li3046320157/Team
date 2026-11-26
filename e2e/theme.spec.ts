import { expect, test, type Page } from '@playwright/test';

async function skipAuthIntro(target: Page) {
  const intro = target.getByTestId('auth-intro');
  if (await intro.isVisible().catch(() => false)) {
    await target.getByTestId('auth-intro-skip').click();
  }
  await expect(intro).toBeHidden();
}

test('认证页进入片头：展示系统说明并可跳过', async ({ page }) => {
  await page.goto('/');
  const intro = page.getByTestId('auth-intro');
  await expect(intro).toBeVisible();
  await expect(intro).toContainText('欢迎进入');
  await expect(intro).toContainText('本地账本系统');
  await expect(intro).toContainText('数据只存这台设备');

  await page.getByTestId('auth-intro-skip').click();
  await expect(intro).toBeHidden();
  await expect(page.getByTestId('auth-username')).toBeVisible();
});

test('登录页金币可互动、配色可切换并持久化', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('auth-page')).toBeVisible();
  await skipAuthIntro(page);
  await expect(page.getByTestId('auth-big-coin')).toBeVisible();
  await expect(page.getByTestId('auth-mini-coin')).toHaveCount(10);

  await page.getByTestId('auth-mini-coin').first().click({ force: true });
  await expect(page.getByText('已点亮 1 枚金币')).toBeVisible();

  await page.getByTestId('palette-ocean').click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'ocean');
  await page.reload();
  await expect(page.getByTestId('auth-page')).toBeVisible();
  await skipAuthIntro(page);
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'ocean');
  await expect(page.getByTestId('palette-ocean')).toHaveAttribute('aria-pressed', 'true');
});

test('登录与注册切换后输入框自动清空', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('auth-page')).toBeVisible();
  await skipAuthIntro(page);

  await page.getByTestId('auth-username').fill('切换前用户');
  await page.getByTestId('auth-password').fill('wrong-pass-123');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-error')).toBeVisible();

  await page.getByTestId('auth-go-register').click();
  await expect(page).toHaveURL(/#\/register$/);
  await expect(page.getByTestId('auth-username')).toHaveValue('');
  await expect(page.getByTestId('auth-password')).toHaveValue('');
  await expect(page.getByTestId('auth-confirm')).toHaveValue('');
  await expect(page.getByTestId('auth-phone')).toHaveValue('');
  await expect(page.getByTestId('auth-recovery-question')).toHaveValue('');
  await expect(page.getByTestId('auth-recovery-answer')).toHaveValue('');

  await page.getByTestId('auth-username').fill('注册页用户');
  await page.getByTestId('auth-phone').fill('13900001111');
  await page.getByTestId('auth-password').fill('reg-pass-123');
  await page.getByTestId('auth-confirm').fill('reg-pass-123');
  await page.getByTestId('auth-recovery-question').selectOption({ index: 1 });
  await page.getByTestId('auth-recovery-answer').fill('切换答案');
  await page.getByTestId('auth-go-login').click();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByTestId('auth-username')).toHaveValue('');
  await expect(page.getByTestId('auth-password')).toHaveValue('');
  await expect(page.getByTestId('auth-confirm')).toHaveCount(0);
  await expect(page.getByTestId('auth-phone')).toHaveCount(0);
  await expect(page.getByTestId('auth-recovery-answer')).toHaveCount(0);
});