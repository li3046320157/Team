import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

async function awaitIntro(target: Page) {
  await expect(target.getByTestId('ledger-intro')).toBeVisible({ timeout: 15_000 });
  await expect(target.getByTestId('ledger-intro')).toBeHidden({ timeout: 20_000 });
}

async function skipAuthIntro(target: Page) {
  const intro = target.getByTestId('auth-intro');
  if (await intro.isVisible().catch(() => false)) {
    await target.getByTestId('auth-intro-skip').click();
  }
  await expect(intro).toBeHidden();
}

async function loadApp(
  target: Page,
  username = 'e2e演示员',
  phone?: string,
  recovery?: { question: string; answer: string },
) {
  await target.goto('/');
  await expect(target.getByTestId('auth-page')).toBeVisible();
  await skipAuthIntro(target);
  await target.getByTestId('auth-go-register').click();
  await expect(target).toHaveURL(/#\/register$/);
  await expect(target.getByTestId('auth-confirm')).toBeVisible();
  await target.getByTestId('auth-username').fill(username);
  if (phone) await target.getByTestId('auth-phone').fill(phone);
  await target.getByTestId('auth-password').fill('e2e-pass-123');
  await target.getByTestId('auth-confirm').fill('e2e-pass-123');
  if (recovery) {
    await target.getByTestId('auth-recovery-question').selectOption({ label: '自定义问题…' });
    await target.getByTestId('auth-recovery-custom').fill(recovery.question);
    await target.getByTestId('auth-recovery-answer').fill(recovery.answer);
  } else {
    await target.getByTestId('auth-recovery-question').selectOption({ label: '我的第一只宠物叫什么名字？' });
    await target.getByTestId('auth-recovery-answer').fill('e2e小猫');
  }
  await target.getByTestId('auth-submit').click();
  await expect(target).toHaveURL(/#\/login$/);
  await expect(target.getByTestId('auth-registered-note')).toBeVisible();
  await expect(target.getByTestId('auth-username')).toHaveValue('');
  await target.getByTestId('auth-username').fill(username);
  await target.getByTestId('auth-password').fill('e2e-pass-123');
  await target.getByTestId('auth-submit').click();
  await expect(target.getByRole('button', { name: '开始记账' })).toBeVisible({ timeout: 60_000 });
  await target.getByPlaceholder('例如：日常账户（留空用默认名）').fill('日常账户');
  await target.getByPlaceholder('0.00').fill('5000');
  await target.getByPlaceholder('例如：5000').fill('1000');
  await target.getByRole('button', { name: '开始记账' }).click();
  await expect(target.getByTestId('dashboard')).toBeVisible({ timeout: 60_000 });
  await awaitIntro(target);
}

test.beforeAll(async ({ browser }) => {
  const reset = await fetch('http://127.0.0.1:5174/functions/v1/app/__dev/reset', { method: 'POST' });
  expect(reset.ok).toBe(true);
  context = await browser.newContext();
  page = await context.newPage();
  await loadApp(page);
});

test.afterAll(async () => {
  await context.close();
});

test('普通用户界面不出现管理员入口', async () => {
  await expect(page.getByTestId('admin-root')).toHaveCount(0);
  await expect(page.getByTestId('admin-gate')).toHaveCount(0);
  await expect(page.getByTestId('admin-nav-users')).toHaveCount(0);
});

test('总览首屏说明系统目的与全部功能，并显示日/月/年现金流摘要', async () => {
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await expect(page.getByTestId('section-mascot')).toBeVisible();
  await expect(page.getByRole('heading', { name: /花钱之前/ })).toBeVisible();
  await expect(page.getByText('全部功能 · 每个模块解决什么问题')).toBeVisible();
  await expect(page.getByRole('heading', { name: '现金流监测 · 日 / 月 / 年' })).toBeVisible();
  await expect(page.getByText('本月结余', { exact: true })).toBeVisible();
  await expect(page.getByTestId('quick-add')).toBeVisible();
});

test('总览：切换日、月、年现金流视图', async () => {
  await page.getByRole('button', { name: '日', exact: true }).click();
  await expect(page.getByText('今日结余', { exact: true })).toBeVisible();
  await expect(page.getByText('近 14 天收支趋势')).toBeVisible();
  await page.getByRole('button', { name: '年', exact: true }).click();
  await expect(page.getByText('今年结余', { exact: true })).toBeVisible();
  await expect(page.getByText('近 5 年收支趋势')).toBeVisible();
  await page.getByRole('button', { name: '月', exact: true }).click();
  await expect(page.getByText('本月结余', { exact: true })).toBeVisible();
});

test('账本：底部栏目索引、左右翻页按钮与页码', async () => {
  await expect(page.getByTestId('book-tab-home')).toBeVisible();
  await page.getByTestId('book-tab-ledger').click();
  await expect(page.getByTestId('ledger')).toBeVisible();
  await expect(page.getByTestId('book-page-chip')).toContainText('02');
  await page.getByTestId('book-next').click();
  await expect(page.getByTestId('schedules')).toBeVisible();
  await expect(page.getByTestId('book-page-chip')).toContainText('03');
  await page.getByTestId('book-prev').click();
  await expect(page.getByTestId('ledger')).toBeVisible();
  await expect(page.getByTestId('book-page-chip')).toContainText('02');
  await expect(page.locator('.book-leaf')).toHaveCount(1);
});

test('账本：滚到底继续下滑、横向滚轮、PageUp/PageDown 均可翻页', async () => {
  await expect(page.getByTestId('ledger')).toBeVisible();
  await expect(page.locator('.book-leaf')).toHaveCount(1);
  const scroll = page.locator('[data-book-scroll]').first();
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.mouse.move(720, 500);
  await page.mouse.wheel(0, 420);
  await expect(page.getByTestId('schedules')).toBeVisible();
  await expect(page.getByTestId('book-page-chip')).toContainText('03');
  await expect(page.locator('.book-leaf')).toHaveCount(1);
  await page.keyboard.press('PageUp');
  await expect(page.getByTestId('ledger')).toBeVisible();
  await expect(page.getByTestId('book-page-chip')).toContainText('02');
  await expect(page.locator('.book-leaf')).toHaveCount(1);
  await page.keyboard.press('PageDown');
  await expect(page.getByTestId('schedules')).toBeVisible();
  await expect(page.locator('.book-leaf')).toHaveCount(1);
  await page.keyboard.press('PageUp');
  await expect(page.getByTestId('ledger')).toBeVisible();
  await expect(page.locator('.book-leaf')).toHaveCount(1);
  await page.mouse.wheel(500, 0);
  await expect(page.getByTestId('schedules')).toBeVisible();
  await expect(page.getByTestId('book-page-chip')).toContainText('03');
  await expect(page.locator('.book-leaf')).toHaveCount(1);
});

test('一句话快速记账：解析、确认并写入流水', async () => {
  await page.goto('/#/ledger?quick=1');
  await expect(page.getByTestId('ledger')).toBeVisible();
  await page.getByTestId('quick-input').fill('昨天买咖啡18.5元');
  await expect(page.getByText('置信度：高')).toBeVisible();
  await page.getByRole('button', { name: '按解析结果记账' }).click();
  await expect(page.getByRole('status')).toContainText('已按解析结果记一笔');
  await expect(page.getByTestId('quick-input')).toHaveValue('');
});

test('表单记一笔：金额、分类必填并显示在当日流水中', async () => {
  await page.getByRole('button', { name: '记一笔' }).click();
  const dialog = page.getByRole('dialog', { name: '记一笔' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('0.00').fill('23.45');
  await dialog.getByRole('button', { name: '确认记账' }).click();
  await expect(dialog.getByText('请选择分类')).toBeVisible();
  await dialog.locator('select').nth(2).selectOption({ index: 1 });
  await dialog.getByPlaceholder('例如：瑞幸咖啡').fill('E2E 测试商户');
  await dialog.getByRole('button', { name: '确认记账' }).click();
  await expect(page.getByRole('status')).toContainText('已记一笔');
  await expect(dialog).toBeHidden();
  await expect(page.getByText('E2E 测试商户').first()).toBeVisible();
});

test('计划：新建今日计划并核销为真实流水', async () => {
  await page.goto('/#/schedules');
  await expect(page.getByTestId('schedules')).toBeVisible();
  await page.getByRole('button', { name: '新建计划' }).first().click();
  const form = page.getByRole('dialog', { name: '新建固定计划' });
  await form.getByLabel('名称').fill('E2E 测试计划');
  await form.getByLabel('金额（元）').fill('12.34');
  await form.locator('select').nth(1).selectOption({ index: 1 });
  await form.getByRole('button', { name: '保存计划' }).click();
  await expect(page.getByRole('status')).toContainText('计划已创建');

  const row = page.locator('li').filter({ hasText: 'E2E 测试计划' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '核销' }).click();
  const settle = page.getByRole('dialog', { name: '核销计划' });
  await settle.getByRole('button', { name: '确认核销' }).click();
  await expect(page.getByRole('status')).toContainText('已核销并写入流水');
  await expect(page.getByText('最近处理记录')).toBeVisible();
});

test('预测：切换 30 天并保持图表与汇总一致', async () => {
  await page.goto('/#/forecast');
  await expect(page.getByTestId('forecast')).toBeVisible();
  await page.getByRole('button', { name: '30 天', exact: true }).click();
  await expect(page.getByRole('heading', { name: '未来 30 天余额曲线' })).toBeVisible();
  await expect(page.getByText('预测假设与限制')).toBeVisible();
});

test('沙盘：运行四种方案并保存方案', async () => {
  await page.goto('/#/sandbox');
  await expect(page.getByTestId('sandbox')).toBeVisible();
  await page.getByTestId('run-sandbox').click();
  await expect(page.getByTestId('scenario-baseline')).toBeVisible();
  await expect(page.getByTestId('scenario-immediate')).toBeVisible();
  await expect(page.getByTestId('scenario-delayed')).toBeVisible();
  await expect(page.getByTestId('scenario-staged')).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('方案已保存');
});

test('目标：创建目标并从自由余额预留', async () => {
  await page.goto('/#/goals');
  await expect(page.getByTestId('goals')).toBeVisible();
  await page.getByTestId('add-goal').click();
  const dialog = page.getByRole('dialog', { name: '新建储蓄目标' });
  await dialog.getByPlaceholder('例如：日本旅行').fill('E2E 旅行目标');
  await dialog.getByPlaceholder('6000.00').fill('1200');
  await page.getByTestId('save-goal').click();
  await expect(page.getByRole('status')).toContainText('目标已创建');
  await expect(page.getByText('E2E 旅行目标').first()).toBeVisible();

  const card = page.locator('.card').filter({ hasText: 'E2E 旅行目标' }).first();
  await card.getByRole('button', { name: '预留' }).click();
  const action = page.getByRole('dialog', { name: /为目标预留/ });
  await expect(action.getByLabel('金额（元）')).not.toHaveValue('');
  await page.getByTestId('confirm-goal-action').click();
  await expect(page.getByRole('status')).toContainText('预留成功');
});

test('数据中心：损坏的备份文件必须在写入前被拒绝', async () => {
  await page.goto('/#/data');
  await expect(page.getByTestId('data-center')).toBeVisible();
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ this is not a backup'),
  });
  const preview = page.getByTestId('import-preview');
  await expect(preview).toBeVisible();
  await expect(preview.getByText('校验失败')).toBeVisible();
  await expect(page.getByTestId('confirm-restore')).toHaveCount(0);
});

test('设置：保存参数后显示已保存标记', async () => {
  await page.goto('/#/settings');
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');
  await expect(page.getByText('已保存', { exact: false }).first()).toBeVisible();
});

test('AI 分析：配置校验、保存与连接失败提示', async () => {
  await page.goto('/#/assistant');
  await expect(page.getByTestId('assistant')).toBeVisible();
  await expect(page.getByTestId('ai-robot')).toBeVisible();
  await page.getByTestId('ai-robot').click();
  await expect(page.getByTestId('ai-robot-bubble')).toBeVisible();
  await page.getByTestId('ai-save').click();
  await expect(page.getByRole('alert')).toContainText('地址');
  await page.getByTestId('ai-base').fill('https://api.example.com/v1');
  await page.getByTestId('ai-key').fill('sk-e2e-fake-key-000000');
  await page.getByTestId('ai-model').fill('e2e-model');
  await page.getByTestId('ai-save').click();
  await expect(page.getByRole('status')).toContainText('AI 接口配置已保存到本机');
  await page.getByTestId('chat-input').fill('你好，请分析我的账本');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-error')).toBeVisible({ timeout: 30_000 });
});

test('登录注册：错误密码提示、退出与重新登录', async () => {
  await page.getByTestId('account-menu').click();
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('auth-page')).toBeVisible();
  await page.getByTestId('auth-username').fill('e2e演示员');
  await page.getByTestId('auth-password').fill('wrong-password');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-error')).toContainText('用户名或密码不正确');
  await page.getByTestId('auth-password').fill('e2e-pass-123');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('user-chip')).toContainText('e2e演示员', { timeout: 60_000 });
  await awaitIntro(page);
  await page.goto('/#/');
  await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 60_000 });
});

test('个人资料与密码：改名后自动刷新，改密后退回登录页', async ({ browser }) => {
  const own = await browser.newContext();
  const ownPage = await own.newPage();
  await loadApp(ownPage, 'e2e资料员');

  await ownPage.getByTestId('account-menu').click();
  await ownPage.getByTestId('account-settings').click();
  await expect(ownPage).toHaveURL(/#\/settings$/);
  await expect(ownPage.getByTestId('settings')).toBeVisible();
  await expect(ownPage.getByTestId('profile-username')).toHaveValue('e2e资料员');

  await ownPage.getByTestId('profile-username').fill('e2e改名员');
  const refreshed = ownPage.waitForEvent('load', { timeout: 20_000 });
  await ownPage.getByTestId('save-profile').click();
  await refreshed;
  await expect(ownPage.getByTestId('user-chip')).toContainText('e2e改名员');
  await expect(ownPage.getByTestId('profile-username')).toHaveValue('e2e改名员');
  await expect(ownPage.getByTestId('settings')).toBeVisible();

  await ownPage.getByTestId('current-password').fill('e2e-pass-123');
  await ownPage.getByTestId('new-password').fill('e2e-pass-456');
  await ownPage.getByTestId('confirm-new-password').fill('e2e-pass-456');
  await ownPage.getByTestId('change-password').click();
  await expect(ownPage.getByTestId('auth-page')).toBeVisible({ timeout: 20_000 });
  await ownPage.getByTestId('auth-username').fill('e2e改名员');
  await ownPage.getByTestId('auth-password').fill('e2e-pass-456');
  await ownPage.getByTestId('auth-submit').click();
  await expect(ownPage.getByTestId('user-chip')).toContainText('e2e改名员', { timeout: 60_000 });
  await ownPage.goto('/#/');
  await expect(ownPage.getByTestId('dashboard')).toBeVisible({ timeout: 60_000 });
  await awaitIntro(ownPage);
  await own.close();
});

test('手机号登录与忘记密码：绑定手机号、回答问题重置密码', async ({ browser }) => {
  const own = await browser.newContext();
  const ownPage = await own.newPage();
  await loadApp(ownPage, 'e2e安全员', '13900139000');

  await ownPage.goto('/#/settings');
  await expect(ownPage.getByTestId('settings')).toBeVisible();
  await expect(ownPage.getByTestId('profile-phone')).toHaveValue('13900139000');
  await expect(ownPage.getByTestId('recovery-status')).toContainText('我的第一只宠物叫什么名字？');

  const customQuestion = '我小时候养的金鱼叫什么名字？';
  await ownPage.getByTestId('recovery-question').selectOption({ label: '自定义问题…' });
  await ownPage.getByTestId('recovery-custom-question').fill(customQuestion);
  await ownPage.getByTestId('recovery-current-password').fill('e2e-pass-123');
  await ownPage.getByTestId('recovery-answer').fill('e2e金鱼');
  await ownPage.getByTestId('save-recovery').click();
  await expect(ownPage.getByRole('status')).toContainText('找回问题已保存');
  await expect(ownPage.getByTestId('recovery-status')).toContainText(customQuestion);

  await ownPage.getByTestId('account-menu').click();
  await ownPage.getByTestId('logout').click();
  await ownPage.getByTestId('auth-username').fill('13900139000');
  await ownPage.getByTestId('auth-password').fill('e2e-pass-123');
  await ownPage.getByTestId('auth-submit').click();
  await expect(ownPage.getByTestId('dashboard')).toBeVisible({ timeout: 60_000 });
  await awaitIntro(ownPage);

  await ownPage.getByTestId('account-menu').click();
  await ownPage.getByTestId('logout').click();
  await ownPage.getByTestId('auth-forgot').click();
  await ownPage.getByTestId('auth-recover-identifier').fill('13900139000');
  await ownPage.getByTestId('auth-recover-lookup').click();
  await expect(ownPage.getByTestId('auth-recover-hint')).toContainText('139****9000');
  await expect(ownPage.getByTestId('auth-recover-question')).toContainText(customQuestion);
  await ownPage.getByTestId('auth-recover-answer').fill('错误答案');
  await ownPage.getByTestId('auth-recover-password').fill('e2e-pass-789');
  await ownPage.getByTestId('auth-recover-confirm').fill('e2e-pass-789');
  await ownPage.getByTestId('auth-recover-submit').click();
  await expect(ownPage.getByTestId('auth-forgot-error')).toContainText('找回答案不正确');
  await ownPage.getByTestId('auth-recover-answer').fill('e2e金鱼');
  await ownPage.getByTestId('auth-recover-submit').click();
  await expect(ownPage.getByTestId('auth-username')).toHaveValue('e2e安全员');
  await ownPage.getByTestId('auth-password').fill('e2e-pass-789');
  await ownPage.getByTestId('auth-submit').click();
  await expect(ownPage.getByTestId('dashboard')).toBeVisible({ timeout: 60_000 });
  await awaitIntro(ownPage);
  await expect(ownPage.getByTestId('user-chip')).toContainText('e2e安全员');
  await own.close();
});

test('清除本机账本后，云端账户保留并重新进入空账本', async () => {
  await page.goto('/#/settings');
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('wipe-local-data').click();
  const dialog = page.getByRole('dialog', { name: '清除本机账本数据？' });
  await dialog.getByTestId('confirm-wipe-local-data').click();
  await expect(page.getByTestId('auth-page')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始记账' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('dashboard')).toHaveCount(0);
});

test('注销账号：两步确认、本机数据销毁且云端账户不可再登录', async ({ browser }) => {
  const own = await browser.newContext();
  const ownPage = await own.newPage();
  await loadApp(ownPage, 'e2e注销员', '13600136000', {
    question: '我小时候养的金鱼叫什么名字？',
    answer: 'e2e金鱼',
  });
  await ownPage.goto('/#/settings');
  await expect(ownPage.getByTestId('settings')).toBeVisible();

  const dbNames = () => ownPage.evaluate(async () => {
    const factory = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> };
    const list = factory.databases ? await factory.databases() : [];
    return list.map((info) => info.name ?? '').filter(Boolean);
  });
  const before = await dbNames();
  const personalDb = before.find((name) => name.startsWith('moneyflow-user-'));
  expect(personalDb).toBeTruthy();

  await ownPage.getByTestId('delete-account').click();
  const dialog = ownPage.getByRole('dialog', { name: '注销账号' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('delete-account-next')).toBeDisabled();
  await dialog.getByTestId('delete-account-ack').check();
  await dialog.getByTestId('delete-account-next').click();
  await expect(dialog.getByText('第 2 步 / 共 2 步 · 验证身份并永久注销')).toBeVisible();

  await dialog.getByTestId('delete-account-username').fill('e2e注销员');
  await dialog.getByTestId('delete-account-password').fill('wrong-password');
  await dialog.getByTestId('confirm-delete-account').click();
  await expect(dialog.getByTestId('delete-account-error')).toContainText('当前密码不正确');

  await dialog.getByTestId('delete-account-password').fill('e2e-pass-123');
  await dialog.getByTestId('confirm-delete-account').click();
  await expect(ownPage.getByTestId('auth-page')).toBeVisible({ timeout: 20_000 });

  await ownPage.getByTestId('auth-username').fill('e2e注销员');
  await ownPage.getByTestId('auth-password').fill('e2e-pass-123');
  await ownPage.getByTestId('auth-submit').click();
  await expect(ownPage.getByTestId('auth-error')).toContainText('用户名或密码不正确');

  const after = await dbNames();
  expect(after).not.toContain(personalDb);
  await own.close();
});

test('管理员：首登强制改密、用户管理与独立控制台', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await adminPage.goto('/');
  await expect(adminPage.getByTestId('auth-page')).toBeVisible();
  await skipAuthIntro(adminPage);
  await adminPage.getByTestId('auth-username').fill('root');
  await adminPage.getByTestId('auth-password').fill('123456');
  await adminPage.getByTestId('auth-submit').click();

  await expect(adminPage.getByTestId('admin-gate')).toBeVisible({ timeout: 30_000 });
  await expect(adminPage.locator('.admin-root')).toBeVisible();
  await expect(adminPage.getByTestId('dashboard')).toHaveCount(0);
  await adminPage.getByTestId('admin-gate-username').fill('账本管理员');
  await adminPage.getByTestId('admin-gate-current').fill('123456');
  await adminPage.getByTestId('admin-gate-password').fill('E2eRoot2026');
  await adminPage.getByTestId('admin-gate-confirm').fill('E2eRoot2026');
  await adminPage.getByTestId('admin-gate-submit').click();
  await expect(adminPage.getByTestId('admin-overview')).toBeVisible({ timeout: 30_000 });
  await expect(adminPage.getByTestId('admin-gate')).toHaveCount(0);

  await adminPage.getByRole('navigation', { name: '管理员导航', exact: true }).getByTestId('admin-nav-users').click();
  await expect(adminPage.getByTestId('admin-users')).toBeVisible();
  await expect(adminPage.getByTestId('admin-user-row').filter({ hasText: 'e2e注销员' })).toHaveCount(0);
  const row = adminPage.getByTestId('admin-user-row').filter({ hasText: 'e2e演示员' }).first();
  await expect(row).toBeVisible();
  await row.click();
  const detail = adminPage.getByTestId('admin-user-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('不包含账本流水');
  await expect(detail).toContainText('完整手机号');
  await adminPage.getByTestId('admin-toggle-status').click();
  await detail.getByRole('button', { name: '确认停用' }).click();
  await expect(detail).toContainText('已停用');
  await adminPage.getByTestId('admin-toggle-status').click();
  await expect(detail).toContainText('账户正常');
  await adminPage.keyboard.press('Escape');
  await expect(detail).toBeHidden();

  await adminPage.getByRole('navigation', { name: '管理员导航', exact: true }).getByTestId('admin-nav-security').click();
  await expect(adminPage.getByTestId('admin-security')).toBeVisible();
  await adminPage.getByTestId('admin-logout').click();
  await expect(adminPage.getByTestId('auth-page')).toBeVisible({ timeout: 20_000 });

  await skipAuthIntro(adminPage);
  await adminPage.getByTestId('auth-username').fill('账本管理员');
  await adminPage.getByTestId('auth-password').fill('E2eRoot2026');
  await adminPage.getByTestId('auth-submit').click();
  await expect(adminPage.getByTestId('admin-overview')).toBeVisible({ timeout: 30_000 });
  await expect(adminPage.getByTestId('admin-gate')).toHaveCount(0);
  await adminContext.close();
});

test('移动端：账本翻页栏与目录抽屉可进入计划页', async ({ browser }) => {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });
  const mp = await mobile.newPage();
  await loadApp(mp, 'e2e移动端', undefined, {
    question: '我最喜欢的一本书是什么？',
    answer: 'e2e账本',
  });
  await mp.goto('/#/settings');
  await expect(mp.getByTestId('recovery-status')).toContainText('我最喜欢的一本书是什么？');
  await expect(mp.getByRole('navigation', { name: '账本翻页' })).toBeVisible();
  await mp.getByTestId('book-toc').click();
  await expect(mp.getByRole('dialog', { name: '账本目录' })).toBeVisible();
  await mp.getByTestId('book-toc-schedules').click();
  await expect(mp.getByTestId('schedules')).toBeVisible();
  await expect(mp.getByTestId('book-page-chip')).toContainText('03');
  await mobile.close();
});

test('账单导入：选支付宝 CSV → 预览新增 5 笔 → 确认后流水页见商户', async () => {
  await page.goto('/#/data');
  await expect(page.getByTestId('data-center')).toBeVisible();
  await page.getByTestId('import-bill-file').setInputFiles(path.resolve('tests', 'fixtures', 'bills', 'alipay-utf8.csv'));
  await expect(page.getByTestId('bill-mapping')).toBeVisible();
  await expect(page.getByTestId('bill-mapping').getByText('支付宝')).toBeVisible();
  await expect(page.getByTestId('bill-account')).toHaveValue(/^acc_/);
  await page.getByTestId('bill-build-plan').click();
  await expect(page.getByTestId('bill-preview')).toBeVisible();
  await expect(page.getByText('新增 5 笔')).toBeVisible();
  await expect(page.getByText('跳过 3 笔')).toBeVisible();
  await page.getByTestId('bill-import-confirm').click();
  await expect(page.getByRole('status')).toContainText('已导入 5 笔，跳过 3 笔');
  await page.goto('/#/ledger');
  await expect(page.getByTestId('ledger')).toBeVisible();
  await expect(page.getByText('美团外卖').first()).toBeVisible();
  await expect(page.getByText('瑞幸咖啡,望京店').first()).toBeVisible();
});

test('到期提醒：逾期计划出现导航徽标，设置可开启提醒并导出 .ics', async () => {
  await page.goto('/#/schedules');
  await expect(page.getByTestId('schedules')).toBeVisible();
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const pastDate = `${twoDaysAgo.getFullYear()}-${pad(twoDaysAgo.getMonth() + 1)}-${pad(twoDaysAgo.getDate())}`;
  await page.getByRole('button', { name: '新建计划' }).first().click();
  const form = page.getByRole('dialog', { name: '新建固定计划' });
  await form.getByLabel('名称').fill('E2E 到期提醒');
  await form.getByLabel('金额（元）').fill('88.88');
  await form.getByLabel('开始日期').fill(pastDate);
  await form.locator('select').nth(1).selectOption({ index: 1 });
  await form.locator('select').nth(2).selectOption({ value: 'day' });
  await form.getByRole('button', { name: '保存计划' }).click();
  await expect(page.getByRole('status')).toContainText('计划已创建');
  await expect(page.getByTestId('schedules-badge')).toHaveText('3');

  await page.goto('/#/settings');
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('reminder-enabled').click();
  await expect(page.getByTestId('reminder-enabled').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-ics').click(),
  ]);
  expect(download.suggestedFilename()).toContain('.ics');
});

test('数据不足：新开户未登记覆盖区间时预测与沙盘显示数据不足', async ({ browser }) => {
  const own = await browser.newContext();
  const ownPage = await own.newPage();
  await loadApp(ownPage, 'e2e数据不足员');
  await ownPage.goto('/#/forecast');
  await expect(ownPage.getByTestId('forecast')).toBeVisible();
  await expect(ownPage.getByText('数据不足', { exact: true })).toBeVisible();
  await expect(ownPage.getByText('预测期内不会低于安全储备')).toHaveCount(0);
  await ownPage.goto('/#/sandbox');
  await expect(ownPage.getByTestId('sandbox')).toBeVisible();
  await expect(ownPage.getByText('历史数据不足，四种路径只反映支出结构差异，不能当作安全结论')).toBeVisible();
  await own.close();
});

test('示例数据：新用户先进示例，退出后回到引导页', async ({ browser }) => {
  const demo = await browser.newContext();
  const dp = await demo.newPage();
  await dp.goto('/');
  await expect(dp.getByTestId('auth-page')).toBeVisible();
  await skipAuthIntro(dp);
  await dp.getByTestId('auth-go-register').click();
  await expect(dp).toHaveURL(/#\/register$/);
  await expect(dp.getByTestId('auth-confirm')).toBeVisible();
  await dp.getByTestId('auth-username').fill('e2e示例员');
  await dp.getByTestId('auth-password').fill('e2e-pass-123');
  await dp.getByTestId('auth-confirm').fill('e2e-pass-123');
  await dp.getByTestId('auth-recovery-question').selectOption({ label: '我的第一只宠物叫什么名字？' });
  await dp.getByTestId('auth-recovery-answer').fill('e2e小猫');
  await dp.getByTestId('auth-submit').click();
  await expect(dp).toHaveURL(/#\/login$/);
  await expect(dp.getByTestId('auth-registered-note')).toBeVisible();
  await dp.getByTestId('auth-username').fill('e2e示例员');
  await dp.getByTestId('auth-password').fill('e2e-pass-123');
  await dp.getByTestId('auth-submit').click();
  await expect(dp.getByRole('button', { name: '开始记账' })).toBeVisible({ timeout: 60_000 });

  await dp.getByTestId('start-demo').click();
  await expect(dp.getByTestId('dashboard')).toBeVisible({ timeout: 60_000 });
  await expect(dp.getByText('当前为 6 个月合成示例数据，所有操作不会写入你的个人账本。')).toBeVisible();
  await expect(dp.getByTestId('exit-demo')).toBeVisible();

  await dp.getByTestId('exit-demo').click();
  await expect(dp.getByRole('button', { name: '开始记账' })).toBeVisible({ timeout: 60_000 });
  await expect(dp.getByTestId('dashboard')).toHaveCount(0);
  await expect(dp.getByTestId('start-demo')).toBeVisible();
  await demo.close();
});
});