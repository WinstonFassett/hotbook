// smoke.mjs — load the harness in a headless browser, check for errors.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const logs = [];
page.on('console', msg => {
  const t = msg.type();
  logs.push(`[${t}] ${msg.text()}`);
  if (t === 'error') errors.push(msg.text());
});
page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const rectCount = await page.locator('v-icicle rect[data-id]').count();
const rowCount = await page.locator('v-side-table div[data-id]').count();
const icicleStatus = await page.locator('#icicle-status').textContent();
const tableStatus = await page.locator('#table-status').textContent();

console.log(JSON.stringify({ rectCount, rowCount, icicleStatus, tableStatus, errors, logs: logs.slice(0, 20) }, null, 2));
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
