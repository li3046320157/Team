/** 用仓库已有的 Playwright Chromium 把 public/icons/icon.svg 渲染为 192/512 PNG。运行：npm run icons */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public', 'icons', 'icon.svg'), 'utf8');
const html = `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100vw;height:100vh}</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: join(root, 'public', 'icons', `icon-${size}.png`) });
  await page.close();
}
await browser.close();
console.log('已生成 public/icons/icon-192.png 与 icon-512.png');
