import { expect, test, type BrowserContext, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

async function loadDemo(target: Page, username = 'e2e演示员') {
  await target.goto('/');
  await expect(target.getByTestId('auth-page')).toBeVisible();
  await target.getByTestId('auth-tab-register').click();
  await target.getByTestId('auth-username').fill(username);
  await target.getByTestId('auth-password').fill('e2e-pass-123');
  await target.getByTestId('auth-confirm').fill('e2e-pass-123');
  await target.getByTestId('auth-submit').click();
  await expect(target.getByTestId('load-demo')).toBeVisible({ timeout: 60_000 });
  await target.getByTestId('load-demo').click();
  await expect(target.getByTestId('dashboard')).toBeVisible({ timeout: 60_000 });
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await loadDemo(page);
});

test.afterAll(async () => {
  await context.close();
});

test('示例数据加载后，总览显示现金流预测与预算摘要', async () => {
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await expect(page.getByRole('heading', { name: '示例总览' })).toBeVisible();
  await expect(page.getByText('未来 30 天余额')).toBeVisible();
  await expect(page.getByTestId('quick-add')).toBeVisible();
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
  await page.locator('input[type="file"]').setInputFiles({
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
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('auth-page')).toBeVisible();
  await page.getByTestId('auth-username').fill('e2e演示员');
  await page.getByTestId('auth-password').fill('wrong-password');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-error')).toContainText('用户名或密码不正确');
  await page.getByTestId('auth-password').fill('e2e-pass-123');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('user-chip')).toContainText('e2e演示员', { timeout: 60_000 });
  await page.goto('/#/');
  await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 60_000 });
});

test('移动端：底部导航与「更多」抽屉可进入计划页', async ({ browser }) => {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });
  const mp = await mobile.newPage();
  await loadDemo(mp, 'e2e移动端');
  await expect(mp.getByRole('navigation', { name: '底部导航' })).toBeVisible();
  await mp.getByRole('button', { name: '更多', exact: true }).click();
  await expect(mp.getByText(/更多功能/)).toBeVisible();
  await mp.getByRole('button', { name: '计划', exact: true }).click();
  await expect(mp.getByTestId('schedules')).toBeVisible();
  await mobile.close();
});