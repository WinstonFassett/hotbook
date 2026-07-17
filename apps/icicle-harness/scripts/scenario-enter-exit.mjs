// scenario-enter-exit.mjs — enter/exit lifecycle fades on structural change.
// Trigger: depth toggle (3 → 1 → 3). Depth change alters the rendered set:
//   depth 3 → 1: leaf + mid-level tiles exit (fade out in place, then evicted)
//   depth 1 → 3: those tiles re-enter (fade in at target geometry)
// Verifies via transitionend events on `opacity` (not magic timeouts) that
// fades actually run, and that exiting tiles linger for the fade window before
// eviction.

import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Each tile is a <g> wrapping a rect-shape <g> (carrying data-id) + a label.
// The enter/exit fade is attached to the outer wrapping <g>.
async function tileIds() {
  return await page.$$eval('v-icicle g[data-id]', (els) =>
    els.map((e) => e.getAttribute('data-id')),
  );
}

// Instrument opacity transitionend on the icicle svg (capture-bubbling so we
// see events from the outer <g> elements that carry the fade).
await page.evaluate(() => {
  window.__opacityTransitions = [];
  const svg = document.querySelector('v-icicle svg');
  svg.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'opacity') {
      // The target is the outer <g> wrapping a tile; its descendant g[data-id]
      // carries the tile id.
      const g = e.target;
      const labeled = g.querySelector('[data-id]');
      window.__opacityTransitions.push({
        id: labeled?.getAttribute('data-id') ?? null,
        elapsed: e.elapsedTime,
      });
    }
  }, true);
});

// === Setup: start at depth 3 (default). Confirm full set rendered. ===
console.log('=== Setup: depth 3 (full tree) ===');
const idsAtDepth3 = await tileIds();
console.log(`  tiles at depth 3: ${idsAtDepth3.length}`);
// 15 nodes: root + 4 categories + 3+2+3+2 leaves = 15
const expectedAtDepth3 = 15;
if (idsAtDepth3.length !== expectedAtDepth3) {
  console.log(`  WARN: expected ${expectedAtDepth3} tiles, got ${idsAtDepth3.length}`);
}

// === Test 1: depth 3 → 1 (exit fade) ===
console.log('\n=== Test 1: depth 3 → 1 (exit fade) ===');
await page.evaluate(() => { window.__opacityTransitions = []; });

// Snapshot the tiles that should exit (everything except root + 4 categories).
const survivingAtDepth1 = ['root', 'housing', 'food', 'transport', 'savings'];
const exitingIds = idsAtDepth3.filter((id) => !survivingAtDepth1.includes(id));
console.log(`  exiting tiles (expected to fade out): ${exitingIds.length}`);

// Confirm exiting tiles start at opacity 1 (fully visible) before the click.
const opacityBeforeExit = await page.evaluate((id) => {
  const g = document.querySelector(`v-icicle g[data-id="${id}"]`);
  const outer = g?.parentElement;
  return outer ? getComputedStyle(outer).opacity : null;
}, exitingIds[0]);
console.log(`  exiting tile opacity before click: ${opacityBeforeExit}`);

await page.click('#btn-depth-1');

// Immediately after the click, exiting tiles should still be in the DOM
// (withExitDelay holds them for the fade window) and start fading.
await page.waitForTimeout(50);
const idsRightAfterExit = await tileIds();
const exitingStillPresent = exitingIds.filter((id) => idsRightAfterExit.includes(id));
console.log(`  exiting tiles still in DOM right after click: ${exitingStillPresent.length}/${exitingIds.length}`);

// Sample computed opacity mid-fade (~150ms in). A running CSS transition will
// report a value strictly between 0 and 1. We can't rely on transitionend for
// exit because withExitDelay evicts at EXIT_MS, racing the 400ms transition's
// end event — the element is removed just before transitionend would fire.
// Sampling computed opacity mid-fade is the robust proof the fade runs.
await page.waitForTimeout(100);
const midFadeSamples = await page.evaluate((ids) => {
  return ids.map((id) => {
    const g = document.querySelector(`v-icicle g[data-id="${id}"]`);
    if (!g) return { id, present: false, opacity: null };
    const outer = g.parentElement;
    return { id, present: true, opacity: outer ? parseFloat(getComputedStyle(outer).opacity) : null };
  });
}, exitingIds);
const midFadeAnimating = midFadeSamples.filter((s) => s.present && s.opacity !== null && s.opacity > 0 && s.opacity < 1);
console.log(`  exiting tiles mid-fade (0<opacity<1) @ ~150ms: ${midFadeAnimating.length}/${exitingIds.length}`);
if (midFadeAnimating[0]) console.log(`  sample mid-fade opacity: ${midFadeAnimating[0].opacity}`);

// Wait for the fade window to complete (EXIT_MS = 400ms + buffer).
await page.waitForTimeout(500);
const idsAtDepth1 = await tileIds();
console.log(`  tiles at depth 1 (after fade): ${idsAtDepth1.length}`);
const exitingRemoved = exitingIds.filter((id) => !idsAtDepth1.includes(id));
console.log(`  exiting tiles evicted after fade: ${exitingRemoved.length}/${exitingIds.length}`);

const exitTransitions = await page.evaluate(() => window.__opacityTransitions);
const exitFades = exitTransitions.filter((t) => exitingIds.includes(t.id));
console.log(`  opacity transitionend (exit, best-effort): ${exitFades.length}`);

// === Test 2: depth 1 → 3 (enter fade) ===
console.log('\n=== Test 2: depth 1 → 3 (enter fade) ===');
await page.evaluate(() => { window.__opacityTransitions = []; });

await page.click('#btn-depth-3');
await page.waitForTimeout(600);
const idsAtDepth3Again = await tileIds();
console.log(`  tiles at depth 3 (after re-enter): ${idsAtDepth3Again.length}`);

const enterTransitions = await page.evaluate(() => window.__opacityTransitions);
const enteringIds = idsAtDepth3Again.filter((id) => !survivingAtDepth1.includes(id));
const enterFades = enterTransitions.filter((t) => enteringIds.includes(t.id));
console.log(`  opacity transitionend (enter): ${enterFades.length}`);
console.log(`  enter fade elapsed (sample): ${enterFades[0]?.elapsed ?? 'none'}`);

const result = {
  errors,
  test1_exitFade: {
    exitingLingered: exitingStillPresent.length === exitingIds.length,
    exitingEvicted: exitingRemoved.length === exitingIds.length,
    fadeRan: midFadeAnimating.length > 0,
    finalCount: idsAtDepth1.length,
    expectedCount: survivingAtDepth1.length,
  },
  test2_enterFade: {
    tilesReentered: idsAtDepth3Again.length === expectedAtDepth3,
    fadeRan: enterFades.length > 0,
  },
};

console.log('\n=== FINAL RESULT ===');
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(
  errors.length > 0 ||
  !result.test1_exitFade.exitingLingered ||
  !result.test1_exitFade.exitingEvicted ||
  !result.test1_exitFade.fadeRan ||
  result.test1_exitFade.finalCount !== result.test1_exitFade.expectedCount ||
  !result.test2_enterFade.tilesReentered ||
  !result.test2_enterFade.fadeRan
    ? 1 : 0,
);
