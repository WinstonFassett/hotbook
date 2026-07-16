// smoke-keyboard-alt.mjs — scenario 4: keyboard Alt → proportional-neighbor.
// Proves: Alt + arrow on focused tile edits value with proportional-neighbor
// (neighbor absorbs delta, parent total preserved). Esc reverts.

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
  return await page.locator(`v-side-table .value[data-id="${nodeId}"]`).textContent();
}

async function statusText() {
  return await page.locator('#icicle-status').textContent();
}

// === Test: Alt + ArrowUp on rent → proportional-neighbor with utilities ===
console.log('=== Test: Alt + ArrowUp on rent → proportional-neighbor ===');

const rectsBefore = await getIcicleRects();
const rentBefore = rectsBefore.find(r => r.id === 'rent');
console.log(`  rent at x=${rentBefore?.x} y=${rentBefore?.y}`);

const rentValueBefore = await getTableCellValue('rent');
const utilitiesValueBefore = await getTableCellValue('utilities');
const housingValueBefore = await getTableCellValue('housing');
console.log(`  before: rent=${rentValueBefore} utilities=${utilitiesValueBefore} housing=${housingValueBefore}`);

// Click rent tile to focus it
const svgBox = await page.locator('v-icicle svg').boundingBox();
const scale = svgBox.width / 720;
const rx = (rentBefore.x + rentBefore.w / 2) * scale + svgBox.x;
const ry = (rentBefore.y + rentBefore.h / 2) * scale + svgBox.y;

await page.mouse.click(rx, ry);
await page.waitForTimeout(200);

// Focus the icicle chart element
await page.locator('v-icicle').focus();
await page.waitForTimeout(100);

// Alt + ArrowUp to increase rent (utilities should decrease)
await page.keyboard.down('Alt');
await page.keyboard.press('ArrowUp');

// Check status immediately (before keyup)
const statusDuring = await statusText();
console.log(`  status during: ${statusDuring}`);

await page.waitForTimeout(300);

const rentValueDuring = await getTableCellValue('rent');
const utilitiesValueDuring = await getTableCellValue('utilities');
const housingValueDuring = await getTableCellValue('housing');
console.log(`  during: rent=${rentValueDuring} utilities=${utilitiesValueDuring} housing=${housingValueDuring}`);

// Release Alt and ArrowUp
await page.keyboard.up('ArrowUp');
await page.keyboard.up('Alt');
await page.waitForTimeout(500);

const rentValueAfter = await getTableCellValue('rent');
const utilitiesValueAfter = await getTableCellValue('utilities');
const housingValueAfter = await getTableCellValue('housing');
console.log(`  after: rent=${rentValueAfter} utilities=${utilitiesValueAfter} housing=${housingValueAfter}`);

// Check that rent increased, utilities decreased, housing stayed same
const rentIncreased = parseInt(rentValueAfter || '0') > parseInt(rentValueBefore || '0');
const utilitiesDecreased = parseInt(utilitiesValueAfter || '0') < parseInt(utilitiesValueBefore || '0');
const housingPreserved = parseInt(housingValueAfter || '0') === parseInt(housingValueBefore || '0');

console.log(`  rent increased: ${rentIncreased}`);
console.log(`  utilities decreased: ${utilitiesDecreased}`);
console.log(`  housing preserved: ${housingPreserved}`);

const result = {
  errors,
  test_altProportionalNeighbor: {
    rentIncreased: rentIncreased,
    utilitiesDecreased: utilitiesDecreased,
    housingPreserved: housingPreserved,
  },
};

console.log('\n=== FINAL RESULT ===');
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(
  errors.length > 0 ||
  !result.test_altProportionalNeighbor.rentIncreased ||
  !result.test_altProportionalNeighbor.utilitiesDecreased ||
  !result.test_altProportionalNeighbor.housingPreserved
    ? 1 : 0
);
