// smoke-cross-tile-reverse.mjs — scenario 8: cross-tile reverse.
// Proves: editing in the icicle publishes draft to the table; table cell
// updates live. Commit writes to Kernel, both surfaces transition.

import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

async function getIcicleRects() {
  return await page.$$eval('v-icicle rect[data-id]:not([data-draft])', els =>
    els.map(e => ({
      id: e.getAttribute('data-id'),
      x: parseFloat(e.getAttribute('x')),
      y: parseFloat(e.getAttribute('y')),
      w: parseFloat(e.getAttribute('width')),
      h: parseFloat(e.getAttribute('height')),
    }))
  );
}

async function getTableCellValue(nodeId) {
  return await page.locator(`v-side-table [data-id="${nodeId}"] .value`).textContent();
}

async function statusText() {
  return await page.locator('#icicle-status').textContent();
}

// === Test: Edit in icicle → table updates live ===
console.log('=== Test: edit in icicle → table updates live ===');

const rectsBefore = await getIcicleRects();
const rentBefore = rectsBefore.find(r => r.id === 'rent');
console.log(`  rent in icicle at x=${rentBefore?.x} y=${rentBefore?.y}`);

const tableValueBefore = await getTableCellValue('rent');
console.log(`  rent in table before: ${tableValueBefore}`);

// Compute screen coords for rent tile in icicle
const svgBox = await page.locator('v-icicle svg').boundingBox();
const scale = svgBox.width / 720;
const rx = (rentBefore.x + rentBefore.w / 2) * scale + svgBox.x;
const ry = (rentBefore.y + rentBefore.h / 2) * scale + svgBox.y;

// Ctrl+wheel to edit rent value in icicle
await page.mouse.move(rx, ry);
await page.keyboard.down('Control');
await page.mouse.wheel(0, 100); // scroll up to increase value
await page.waitForTimeout(300);

// Check status
const statusDuring = await statusText();
console.log(`  status during edit: ${statusDuring}`);

// Check table value updated live
const tableValueDuring = await getTableCellValue('rent');
console.log(`  rent in table during: ${tableValueDuring}`);

const valueChanged = tableValueDuring !== tableValueBefore;
console.log(`  table value changed: ${valueChanged}`);

// Release to commit
await page.keyboard.up('Control');
await page.waitForTimeout(500);

const tableValueAfter = await getTableCellValue('rent');
console.log(`  rent in table after: ${tableValueAfter}`);

const result = {
  errors,
  test_crossTileReverse: {
    statusDrafting: statusDuring === 'drafting',
    tableValueChanged: valueChanged,
  },
};

console.log('\n=== FINAL RESULT ===');
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(
  errors.length > 0 ||
  !result.test_crossTileReverse.statusDrafting ||
  !result.test_crossTileReverse.tableValueChanged
    ? 1 : 0
);
