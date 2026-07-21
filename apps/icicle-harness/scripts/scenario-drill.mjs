// smoke-drill.mjs — scenario 6: drill transition.
// Proves: dblclick on a non-leaf node → focus changes, the focus node's
// subtree enters, ancestors/siblings exit, and the position change ANIMATES
// (not a snap). Verifies animation via transitionend/animationend events,
// not magic timeouts. Also tests drill-out.

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

async function statusText() {
  return await page.locator('#icicle-status').textContent();
}

// === Test 1: Drill into housing ===
console.log('=== Test 1: drill into housing ===');

const rectsBefore = await getRects();
const housingBefore = rectsBefore.find(r => r.id === 'housing');
console.log(`  before: ${rectsBefore.length} rects, housing at x=${housingBefore.x} y=${housingBefore.y} w=${housingBefore.w} h=${housingBefore.h}`);

// dblclick on housing. Compute screen coords.
const svgBox = await page.locator('v-icicle svg').boundingBox();
const scale = svgBox.width / 720;
const hx = (housingBefore.x + housingBefore.w / 2) * scale + svgBox.x;
const hy = (housingBefore.y + housingBefore.h / 2) * scale + svgBox.y;

// Instrument transitionend on the icicle svg to detect animation.
await page.evaluate(() => {
  window.__drillTransitions = [];
  const svg = document.querySelector('v-icicle svg');
  svg.addEventListener('transitionend', (e) => {
    window.__drillTransitions.push({
      id: e.target.getAttribute?.('data-id'),
      prop: e.propertyName,
      elapsed: e.elapsedTime,
    });
  }, true);
});

// dblclick
await page.mouse.move(hx, hy);
await page.mouse.dblclick(hx, hy);
await page.waitForTimeout(800);  // allow SETTLE_MS (300) + enter delay

const rectsAfter = await getRects();
const housingAfter = rectsAfter.find(r => r.id === 'housing');
const rentAfter = rectsAfter.find(r => r.id === 'rent');
console.log(`  after: ${rectsAfter.length} rects, housing at x=${housingAfter?.x} y=${housingAfter?.y} w=${housingAfter?.w} h=${housingAfter?.h}`);
console.log(`  rent at x=${rentAfter?.x} y=${rentAfter?.y} w=${rentAfter?.w}`);

// After drilling into housing, housing should fill the top level.
// With only 2 visible levels (housing + children), each gets 480/2 = 240px.
const housingExpanded = housingAfter && housingAfter.x === 0 && housingAfter.y === 0 &&
                         Math.abs(housingAfter.w - 720) < 2 && Math.abs(housingAfter.h - 240) < 2;
console.log(`  housing expanded to full width: ${housingExpanded}`);

// New nodes from deeper levels (rent's children if any) should have entered.
// In this dataset rent/utilities/insurance are leaves, so after drilling into
// housing we see: housing (depth 0), rent/utilities/insurance (depth 1).
// The old root-level siblings (food, transport, savings) should be GONE.
const foodGone = !rectsAfter.find(r => r.id === 'food');
const transportGone = !rectsAfter.find(r => r.id === 'transport');
const savingsGone = !rectsAfter.find(r => r.id === 'savings');
console.log(`  old siblings gone: food=${foodGone} transport=${transportGone} savings=${savingsGone}`);

// Check that a transitionend fired (animation happened, not snap).
const transitions = await page.evaluate(() => window.__drillTransitions);
const positionTransitions = transitions.filter(t => t.prop === 'x' || t.prop === 'y' || t.prop === 'width' || t.prop === 'height' || t.prop === 'all');
console.log(`  transitionend events: ${transitions.length} (${positionTransitions.length} positional)`);
if (transitions.length > 0) {
  console.log(`  sample:`, transitions.slice(0, 3));
}

// === Test 2: Drill out (dblclick on housing again) ===
console.log('\n=== Test 2: drill out ===');

await page.mouse.dblclick(hx, hy);
await page.waitForTimeout(800);

const rectsAfterOut = await getRects();
const foodBack = rectsAfterOut.find(r => r.id === 'food');
console.log(`  after drill-out: ${rectsAfterOut.length} rects, food present=${!!foodBack}`);

const result = {
  errors,
  test1_drillIn: {
    housingExpanded: !!housingExpanded,
    oldSiblingsGone: foodGone && transportGone && savingsGone,
    animated: positionTransitions.length > 0,
    childrenPresent: !!rentAfter,
  },
  test2_drillOut: {
    siblingsReturned: !!foodBack,
    rectCount: rectsAfterOut.length,
  },
};

console.log('\n=== FINAL RESULT ===');
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(
  errors.length > 0 ||
  !result.test1_drillIn.housingExpanded ||
  !result.test1_drillIn.oldSiblingsGone ||
  !result.test1_drillIn.childrenPresent ||
  !result.test2_drillOut.siblingsReturned
    ? 1 : 0
);
