// inspect.mjs — dump the icicle SVG rects and table rows for verification.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Get all icicle rect positions
const rects = await page.$$eval('v-icicle rect[data-id]', els =>
  els.map(e => ({
    id: e.getAttribute('data-id'),
    x: parseFloat(e.getAttribute('x')),
    y: parseFloat(e.getAttribute('y')),
    w: parseFloat(e.getAttribute('width')),
    h: parseFloat(e.getAttribute('height')),
    fill: e.getAttribute('fill'),
  }))
);

// Get table rows
const rows = await page.$$eval('v-side-table div[data-id]', els =>
  els.map(e => ({
    id: e.getAttribute('data-id'),
    text: e.textContent?.trim().substring(0, 30),
  })).filter(r => r.text && !r.text.includes('▾') && !r.text.includes('▸'))
);

console.log('=== ICICLE RECTS (' + rects.length + ') ===');
for (const r of rects) {
  console.log(`  ${r.id}: x=${r.x.toFixed(0)} y=${r.y.toFixed(0)} w=${r.w.toFixed(0)} h=${r.h.toFixed(0)} fill=${r.fill?.substring(0,20)}`);
}

console.log('\n=== TABLE ROWS (' + rows.length + ') ===');
for (const r of rows) {
  console.log(`  ${r.id}: ${r.text}`);
}

await browser.close();
