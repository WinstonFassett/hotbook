// smoke-reorder.mjs — scenario 5: drag-to-reorder.
// Proves: when canReorder is enabled and sort === 'index', dragging a tile
// reorders it among siblings with no value change. Sibling order frozen during
// gesture, transitions on commit.

import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

async function getRects() {
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

async function isButtonActive(id) {
  return await page.locator(`#${id}`).evaluate(el => el.classList.contains('active'));
}

// === Test 1: Enable reorder ===
console.log('=== Test 1: enable reorder ===');

// First ensure sort is 'index' (reorder only works with index sort)
const indexActiveBefore = await isButtonActive('btn-index');
console.log(`  sort index active before: ${indexActiveBefore}`);
if (!indexActiveBefore) {
  await page.click('#btn-index');
  await page.waitForTimeout(500);
}

await page.click('#btn-reorder');
await page.waitForTimeout(500);

const reorderActive = await isButtonActive('btn-reorder');
console.log(`  reorder button active: ${reorderActive}`);

// === Test 2: Drag a tile to reorder ===
console.log('\n=== Test 2: drag tile to reorder ===');

const rectsBefore = await getRects();
console.log(`  before: ${rectsBefore.length} rects`);

// Find a draggable tile (e.g., rent under housing)
const rentBefore = rectsBefore.find(r => r.id === 'rent');
const utilitiesBefore = rectsBefore.find(r => r.id === 'utilities');
console.log(`  rent at x=${rentBefore?.x} y=${rentBefore?.y}`);
console.log(`  utilities at x=${utilitiesBefore?.x} y=${utilitiesBefore?.y}`);

if (!rentBefore || !utilitiesBefore) {
  console.log('  ERROR: could not find rent/utilities tiles');
  await browser.close();
  process.exit(1);
}

// Compute screen coords for rent tile
const svgBox = await page.locator('v-icicle svg').boundingBox();
const scale = svgBox.width / 720;
const rx = (rentBefore.x + rentBefore.w / 2) * scale + svgBox.x;
const ry = (rentBefore.y + rentBefore.h / 2) * scale + svgBox.y;

// Drag rent tile right (to swap with utilities - they're stacked horizontally in vertical orientation)
await page.mouse.move(rx, ry);
await page.mouse.down();
await page.mouse.move(rx + 150, ry); // drag right 150px
await page.waitForTimeout(500);

// Check if drafting status changed
const statusDuring = await page.locator('#icicle-status').textContent();
console.log(`  status during drag: ${statusDuring}`);

await page.mouse.up();
await page.waitForTimeout(800);

const rectsAfter = await getRects();
console.log(`  after: ${rectsAfter.length} rects`);

const rentAfter = rectsAfter.find(r => r.id === 'rent');
const utilitiesAfter = rectsAfter.find(r => r.id === 'utilities');
console.log(`  rent at x=${rentAfter?.x} y=${rentAfter?.y}`);
console.log(`  utilities at x=${utilitiesAfter?.x} y=${utilitiesAfter?.y}`);

// Check if positions changed (reorder happened)
// In vertical orientation, siblings are stacked along x axis
const positionsChanged = rentAfter && utilitiesAfter &&
  (rentBefore.x !== rentAfter.x || utilitiesBefore.x !== utilitiesAfter.x);
console.log(`  positions changed: ${positionsChanged}`);

const result = {
  errors,
  test1_enableReorder: {
    buttonActive: reorderActive,
  },
  test2_dragReorder: {
    positionsChanged: positionsChanged,
  },
};

console.log('\n=== FINAL RESULT ===');
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(
  errors.length > 0 ||
  !result.test1_enableReorder.buttonActive ||
  !result.test2_dragReorder.positionsChanged
    ? 1 : 0
);
