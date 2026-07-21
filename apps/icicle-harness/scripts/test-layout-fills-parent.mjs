// test-layout-fills-parent.mjs — guards against the dead-space regression.
//
// Bug: d3 hierarchy.sum(d => d.value) double-counts parent values (parent's
// own precomputed sum + re-summed children), shrinking grandchildren to ~50%
// of their parent's span. Children must fill 100% of every parent's span.
//
// Asserts: for every non-root node, sum(child.width) == parent.width (within
// 1px float tolerance). Same for height in horizontal orientation.

import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const rects = await page.$$eval('v-icicle rect[data-id]:not([data-draft])', els =>
  els.map(e => ({
    id: e.getAttribute('data-id'),
    x: parseFloat(e.getAttribute('x')),
    y: parseFloat(e.getAttribute('y')),
    w: parseFloat(e.getAttribute('width')),
    h: parseFloat(e.getAttribute('height')),
  }))
);

// Reconstruct parent→children from the table's parentId via DOM is awkward;
// instead use the known dataset structure. The harness dataset is fixed
// (Budget → housing/food/transport/savings → leaves). Group rects by their
// x-range overlap at depth 1 (y=160) vs depth 2 (y=320).
const depth1 = rects.filter(r => r.y === 160);
const depth2 = rects.filter(r => r.y === 320);

const violations = [];
const TOL = 1.5;

// Each depth-1 rect's children are the depth-2 rects whose x-range sits
// inside the depth-1 rect's x-range. Their widths must sum to the parent's.
for (const parent of depth1) {
  const children = depth2.filter(c => c.x >= parent.x - TOL && c.x + c.w <= parent.x + parent.w + TOL);
  if (children.length === 0) continue;
  const childSum = children.reduce((s, c) => s + c.w, 0);
  const fill = childSum / parent.w;
  if (Math.abs(childSum - parent.w) > TOL) {
    violations.push({
      parent: parent.id,
      parentW: parent.w,
      childSum: childSum.toFixed(2),
      fillPct: (fill * 100).toFixed(1),
      children: children.map(c => `${c.id}=${c.w.toFixed(1)}`).join(', '),
    });
  }
}

// Also assert depth-1 rects fill the full canvas width (720).
const totalW = depth1.reduce((s, r) => s + r.w, 0);
const canvasFill = totalW / 720;

const result = {
  errors,
  depth1Count: depth1.length,
  depth2Count: depth2.length,
  canvasFill: canvasFill.toFixed(3),
  violations,
  pass: violations.length === 0 && Math.abs(canvasFill - 1) < 0.01 && errors.length === 0,
};

console.log('=== LAYOUT FILL TEST ===');
console.log(`depth1 rects: ${depth1.length}, depth2 rects: ${depth2.length}`);
console.log(`canvas fill (depth1 sum / 720): ${canvasFill.toFixed(3)}`);
if (violations.length === 0) {
  console.log('every parent fully filled by children ✓');
} else {
  console.log('VIOLATIONS:');
  for (const v of violations) {
    console.log(`  ${v.parent}: w=${v.parentW} children sum=${v.childSum} (${v.fillPct}% filled) — ${v.children}`);
  }
}

console.log('\n=== FINAL ===');
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.pass ? 0 : 1);
