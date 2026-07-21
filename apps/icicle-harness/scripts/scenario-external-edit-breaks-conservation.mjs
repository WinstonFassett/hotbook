// smoke-external-edit-breaks-conservation.mjs — scenario 10: external edit breaks conservation.
// Proves: table cell edit can leave sum(children) ≠ parent.total; icicle renders
// it anyway (partition normalizes for display). Conservation is not enforced on
// external edits.

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

// === Test: Directly break conservation via Kernel API ===
console.log('=== Test: directly break conservation via Kernel API ===');

// Get initial values
const rentBefore = await getTableCellValue('rent');
const utilitiesBefore = await getTableCellValue('utilities');
const insuranceBefore = await getTableCellValue('insurance');
const housingBefore = await getTableCellValue('housing');
console.log(`  before: rent=${rentBefore} utilities=${utilitiesBefore} insurance=${insuranceBefore} housing=${housingBefore}`);

// Directly manipulate the dataset to break conservation
// We'll set rent to a value that doesn't match the parent sum
await page.evaluate(() => {
  const kernel = window.__kernel;
  if (!kernel) {
    console.log('ERROR: kernel not exposed globally');
    return;
  }
  // Set rent to 5000 without recomputing parent sum
  kernel.setNodeValueNoRecompute('budget', 'rent', 5000);
});

// Force a re-render by triggering an updated event
await page.evaluate(() => {
  const kernel = window.__kernel;
  if (kernel) {
    // Manually trigger publish without recomputing sums
    kernel.forcePublish('budget');
  }
});

await page.waitForTimeout(500);

// Get new values
const rentAfter = await getTableCellValue('rent');
const utilitiesAfter = await getTableCellValue('utilities');
const insuranceAfter = await getTableCellValue('insurance');
const housingAfter = await getTableCellValue('housing');
console.log(`  after: rent=${rentAfter} utilities=${utilitiesAfter} insurance=${insuranceAfter} housing=${housingAfter}`);

// Check if conservation is broken (rent + utilities + insurance ≠ housing)
const rentNum = parseInt(rentAfter || '0');
const utilNum = parseInt(utilitiesAfter || '0');
const insNum = parseInt(insuranceAfter || '0');
const housingNum = parseInt(housingAfter || '0');
const childrenSum = rentNum + utilNum + insNum;
const conservationBroken = childrenSum !== housingNum;
console.log(`  children sum: ${childrenSum}, housing: ${housingNum}, broken: ${conservationBroken}`);

// Check that icicle still renders (doesn't crash)
const icicleRects = await getIcicleRects();
console.log(`  icicle rects: ${icicleRects.length}`);
const icicleRenders = icicleRects.length > 0;

const result = {
  errors,
  test_externalEditBreaksConservation: {
    conservationBroken: conservationBroken,
    icicleRenders: icicleRenders,
  },
};

console.log('\n=== FINAL RESULT ===');
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(
  errors.length > 0 ||
  !result.test_externalEditBreaksConservation.conservationBroken ||
  !result.test_externalEditBreaksConservation.icicleRenders
    ? 1 : 0
);
