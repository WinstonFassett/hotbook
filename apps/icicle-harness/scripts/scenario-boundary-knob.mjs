// smoke-boundary-knob.mjs — scenario 1: boundary knob (edge handle) drag.
// Proves: two-sibling reapportion — pair sum preserved, only the two
// adjacent siblings change, all other tiles frozen during gesture, commit
// writes both values to the Kernel, Esc reverts.

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

async function tableVal(id) {
  const cells = await page.locator(`v-side-table div[data-id="${id}"]`).all();
  for (const cell of cells) {
    const text = await cell.textContent();
    if (text && /^\d+$/.test(text.trim())) return parseInt(text.trim());
  }
  return null;
}

async function statusText() {
  return await page.locator('#icicle-status').textContent();
}

function rectById(rects, id) { return rects.find(r => r.id === id); }
function eqRect(a, b, tol = 0.5) {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol &&
         Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
}

// === Test 1: drag rent|utilities edge toward utilities (rent grows, utilities shrinks) ===
console.log('=== Test 1: boundary knob drag (rent|utilities) ===');

// Check if edge handles are rendered
const edgeHandles = await page.locator('v-icicle [data-edge]').count();
console.log(`  edge handles rendered: ${edgeHandles}`);

if (edgeHandles === 0) {
  console.log('  ERROR: no edge handles rendered - cannot test');
  await browser.close();
  process.exit(1);
}

// Edge handle is at x ≈ rent.x + rent.w - 4 (HIT/2). Compute screen coords.
const svgBox = await page.locator('v-icicle svg').boundingBox();
const scale = svgBox.width / 720;
const rectsBefore = await getRects();
const rentR = rectById(rectsBefore, 'rent');
const edgeX = (rentR.x + rentR.w) * scale + svgBox.x;  // boundary in screen px
const edgeY = (rentR.y + rentR.h / 2) * scale + svgBox.y;

const rentBefore = await tableVal('rent');
const utilBefore = await tableVal('utilities');
const insuranceBefore = await tableVal('insurance');
const pairSum = rentBefore + utilBefore;
console.log(`  before: rent=${rentBefore}, utilities=${utilBefore}, pairSum=${pairSum}`);

// Drag the edge right by 40px (rent grows by 40/scale px worth of value).
const dragPx = 40;
await page.mouse.move(edgeX, edgeY);
await page.mouse.down();
await page.waitForTimeout(80);
// First move starts the gesture.
await page.mouse.move(edgeX + dragPx, edgeY, { steps: 3 });
await page.waitForTimeout(200);

const statusDuring = await statusText();
const drafts = await page.locator('v-icicle rect[data-draft]').count();
const rectsDuring = await getRects();
console.log(`  during: status=${statusDuring}, draft overlays=${drafts}`);

// Siblings-frozen: every rect except rent and utilities must be unchanged.
const edited = new Set(['rent', 'utilities']);
let frozen = true;
for (const r of rectsDuring) {
  if (edited.has(r.id)) continue;
  const before = rectById(rectsBefore, r.id);
  if (!before || !eqRect(before, r)) { frozen = false; console.log(`  MOVED: ${r.id}`, before, r); break; }
}
console.log(`  siblings frozen: ${frozen}`);

// The pair's combined span should be unchanged (sum preserved in geometry too).
const rentD = rectById(rectsDuring, 'rent');
const utilD = rectById(rectsDuring, 'utilities');
// Note: draft overlays render separately; the underlying tile rects may not
// move during the draft (siblings frozen includes the edited nodes' base
// rects). The draft overlay rects carry the new spans. Check those:
const draftRects = await page.$$eval('v-icicle rect[data-draft]', els =>
  els.map(e => ({
    id: e.getAttribute('data-draft-id'),
    w: parseFloat(e.getAttribute('width')),
  }))
);
const rentDraft = draftRects.find(d => d.id === 'rent');
const utilDraft = draftRects.find(d => d.id === 'utilities');
console.log(`  draft spans: rent=${rentDraft?.w.toFixed(1)}, utilities=${utilDraft?.w.toFixed(1)}`);

// Release → commit.
await page.mouse.up();
await page.waitForTimeout(500);

const statusAfter = await statusText();
const rentAfter = await tableVal('rent');
const utilAfter = await tableVal('utilities');
const insuranceAfter = await tableVal('insurance');
const draftAfter = await page.locator('v-icicle rect[data-draft]').count();
console.log(`  after commit: status=${statusAfter}, rent=${rentAfter}, utilities=${utilAfter}, draft=${draftAfter}`);

const sumPreserved = (rentAfter + utilAfter) === pairSum;
const rentGrew = rentAfter > rentBefore;
const utilShrank = utilAfter < utilBefore;
const insuranceUntouched = insuranceAfter === insuranceBefore;
console.log(`  sum preserved: ${sumPreserved} (${rentAfter}+${utilAfter}=${rentAfter+utilAfter} vs ${pairSum})`);
console.log(`  rent grew: ${rentGrew}, utilities shrank: ${utilShrank}, insurance untouched: ${insuranceUntouched}`);

// === Test 2: Esc reverts an in-flight boundary drag ===
console.log('\n=== Test 2: Esc reverts boundary drag ===');

const baselineRent = await tableVal('rent');
const baselineUtil = await tableVal('utilities');
// Recompute edge position — test 1 changed rent's width.
const rectsAfter1 = await getRects();
const rentR2 = rectById(rectsAfter1, 'rent');
const edgeX2 = (rentR2.x + rentR2.w) * scale + svgBox.x;
const edgeY2 = (rentR2.y + rentR2.h / 2) * scale + svgBox.y;
await page.mouse.move(edgeX2, edgeY2);
await page.mouse.down();
await page.waitForTimeout(80);
await page.mouse.move(edgeX2 - 30, edgeY2, { steps: 3 });  // drag left: rent shrinks
await page.waitForTimeout(200);
const statusDuring2 = await statusText();
console.log(`  during drag: status=${statusDuring2}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.mouse.up();  // clean up listeners (Esc cancelled, no commit)
await page.waitForTimeout(200);
const rentAfterEsc = await tableVal('rent');
const utilAfterEsc = await tableVal('utilities');
const statusAfterEsc = await statusText();
console.log(`  after Esc: rent=${rentAfterEsc}, utilities=${utilAfterEsc}, status=${statusAfterEsc}`);

const reverted = rentAfterEsc === baselineRent && utilAfterEsc === baselineUtil;

// === Results ===
const result = {
  errors,
  test1_boundary: {
    drafted: statusDuring === 'drafting',
    draftOverlays: drafts === 2,
    siblingsFrozen: frozen,
    committed: statusAfter === 'idle',
    sumPreserved,
    rentGrew,
    utilitiesShrank: utilShrank,
    insuranceUntouched,
    draftCleared: draftAfter === 0,
  },
  test2_escRevert: {
    drafted: statusDuring2 === 'drafting',
    revertedToCommitted: reverted,
    statusIdle: statusAfterEsc === 'idle',
  },
};

console.log('\n=== FINAL RESULT ===');
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(
  errors.length > 0 ||
  !result.test1_boundary.drafted ||
  !result.test1_boundary.siblingsFrozen ||
  !result.test1_boundary.sumPreserved ||
  !result.test1_boundary.rentGrew ||
  !result.test1_boundary.committed ||
  !result.test2_escRevert.revertedToCommitted
    ? 1 : 0
);
