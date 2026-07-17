import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Check labels are visible
const labels = await page.evaluate(() => {
  const texts = document.querySelectorAll('v-icicle text');
  return Array.from(texts).filter(t => t.textContent.length > 0).map(t => ({
    text: t.textContent.slice(0,10),
    rect: t.getBoundingClientRect(),
  }));
});
console.log(`Visible labels: ${labels.length}`);
labels.slice(0,5).forEach(l => console.log(`  "${l.text}" at ${l.rect.x.toFixed(0)},${l.rect.y.toFixed(0)}`));

// Check label transition on depth change
const before = await page.evaluate(() => {
  const texts = document.querySelectorAll('v-icicle text');
  for (const t of texts) { if (t.textContent === 'Housing') return t.getBoundingClientRect().y; }
});
console.log(`\nHousing label before: y=${before.toFixed(1)}`);

await page.click('#btn-depth-1');
await page.waitForTimeout(50);
const at50 = await page.evaluate(() => {
  const texts = document.querySelectorAll('v-icicle text');
  for (const t of texts) { if (t.textContent === 'Housing') return t.getBoundingClientRect().y; }
});
console.log(`Housing label 50ms: y=${at50.toFixed(1)}`);
await page.waitForTimeout(400);
const after = await page.evaluate(() => {
  const texts = document.querySelectorAll('v-icicle text');
  for (const t of texts) { if (t.textContent === 'Housing') return t.getBoundingClientRect().y; }
});
console.log(`Housing label after: y=${after.toFixed(1)}`);
console.log(`Label transitioning: ${at50 !== after && at50 !== before}`);

console.log(`\nerrors: ${errors.length}`);
if (errors.length) errors.slice(0,5).forEach(e => console.log(`  - ${e}`));
await browser.close();
