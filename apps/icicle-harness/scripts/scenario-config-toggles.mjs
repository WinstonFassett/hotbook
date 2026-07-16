// smoke-config-toggles.mjs — scenarios 11, 12: config toggle transitions.
// Proves: orientation toggle (vertical ↔ horizontal) and sort toggle (index ↔ value)
// trigger `updated` transitions and animate (not snap). Verifies animation via
// transitionend events, not magic timeouts.

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

// Instrument transitionend on the icicle svg to detect animation.
await page.evaluate(() => {
  window.__configTransitions = [];
  const svg = document.querySelector('v-icicle svg');
  svg.addEventListener('transitionend', (e) => {
    window.__configTransitions.push({
      id: e.target.getAttribute?.('data-id'),
      prop: e.propertyName,
      elapsed: e.elapsedTime,
    });
  }, true);
});

// === Test 1: Orientation toggle (vertical → horizontal) ===
console.log('=== Test 1: orientation toggle (vertical → horizontal) ===');

const rectsBefore = await getRects();
console.log(`  before: ${rectsBefore.length} rects`);
const vertActive = await isButtonActive('btn-vert');
const horizActive = await isButtonActive('btn-horiz');
console.log(`  button state: vertical=${vertActive} horizontal=${horizActive}`);

// Click horizontal button
await page.click('#btn-horiz');
await page.waitForTimeout(800);  // allow transition

const rectsAfterHoriz = await getRects();
console.log(`  after horizontal: ${rectsAfterHoriz.length} rects`);
const vertActiveAfter = await isButtonActive('btn-vert');
const horizActiveAfter = await isButtonActive('btn-horiz');
console.log(`  button state: vertical=${vertActiveAfter} horizontal=${horizActiveAfter}`);

// Check that rects changed (orientation swap should change x/y vs w/h)
const orientationChanged = rectsAfterHoriz.some(r => {
  const before = rectsBefore.find(b => b.id === r.id);
  return before && (before.x !== r.x || before.y !== r.y || before.w !== r.w || before.h !== r.h);
});
console.log(`  rects changed: ${orientationChanged}`);

// Check transitionend events
const transitions1 = await page.evaluate(() => window.__configTransitions);
const positionTransitions1 = transitions1.filter(t => t.prop === 'x' || t.prop === 'y' || t.prop === 'width' || t.prop === 'height' || t.prop === 'all');
console.log(`  transitionend events: ${transitions1.length} (${positionTransitions1.length} positional)`);

// === Test 2: Orientation toggle (horizontal → vertical) ===
console.log('\n=== Test 2: orientation toggle (horizontal → vertical) ===');

await page.evaluate(() => { window.__configTransitions = []; });

await page.click('#btn-vert');
await page.waitForTimeout(800);

const rectsAfterVert = await getRects();
console.log(`  after vertical: ${rectsAfterVert.length} rects`);
const vertActiveFinal = await isButtonActive('btn-vert');
const horizActiveFinal = await isButtonActive('btn-horiz');
console.log(`  button state: vertical=${vertActiveFinal} horizontal=${horizActiveFinal}`);

const transitions2 = await page.evaluate(() => window.__configTransitions);
const positionTransitions2 = transitions2.filter(t => t.prop === 'x' || t.prop === 'y' || t.prop === 'width' || t.prop === 'height' || t.prop === 'all');
console.log(`  transitionend events: ${transitions2.length} (${positionTransitions2.length} positional)`);

// === Test 3: Sort toggle (index → value) ===
console.log('\n=== Test 3: sort toggle (index → value) ===');

const rectsBeforeSort = await getRects();
console.log(`  before: ${rectsBeforeSort.length} rects`);
const indexActive = await isButtonActive('btn-index');
const valueActive = await isButtonActive('btn-value');
console.log(`  button state: index=${indexActive} value=${valueActive}`);

await page.evaluate(() => { window.__configTransitions = []; });

await page.click('#btn-value');
await page.waitForTimeout(800);

const rectsAfterValue = await getRects();
console.log(`  after value sort: ${rectsAfterValue.length} rects`);
const indexActiveAfter = await isButtonActive('btn-index');
const valueActiveAfter = await isButtonActive('btn-value');
console.log(`  button state: index=${indexActiveAfter} value=${valueActiveAfter}`);

// Check that rects changed (sort should reorder siblings)
const sortChanged = rectsAfterValue.some(r => {
  const before = rectsBeforeSort.find(b => b.id === r.id);
  return before && (before.x !== r.x || before.y !== r.y);
});
console.log(`  rects changed: ${sortChanged}`);

const transitions3 = await page.evaluate(() => window.__configTransitions);
const positionTransitions3 = transitions3.filter(t => t.prop === 'x' || t.prop === 'y' || t.prop === 'width' || t.prop === 'height' || t.prop === 'all');
console.log(`  transitionend events: ${transitions3.length} (${positionTransitions3.length} positional)`);

// === Test 4: Sort toggle (value → index) ===
console.log('\n=== Test 4: sort toggle (value → index) ===');

await page.evaluate(() => { window.__configTransitions = []; });

await page.click('#btn-index');
await page.waitForTimeout(800);

const rectsAfterIndex = await getRects();
console.log(`  after index sort: ${rectsAfterIndex.length} rects`);
const indexActiveFinal = await isButtonActive('btn-index');
const valueActiveFinal = await isButtonActive('btn-value');
console.log(`  button state: index=${indexActiveFinal} value=${valueActiveFinal}`);

const transitions4 = await page.evaluate(() => window.__configTransitions);
const positionTransitions4 = transitions4.filter(t => t.prop === 'x' || t.prop === 'y' || t.prop === 'width' || t.prop === 'height' || t.prop === 'all');
console.log(`  transitionend events: ${transitions4.length} (${positionTransitions4.length} positional)`);

const result = {
  errors,
  test1_orientationToHorizontal: {
    buttonToggled: !vertActiveAfter && horizActiveAfter,
    rectsChanged: orientationChanged,
    animated: positionTransitions1.length > 0,
  },
  test2_orientationToVertical: {
    buttonToggled: vertActiveFinal && !horizActiveFinal,
    animated: positionTransitions2.length > 0,
  },
  test3_sortToValue: {
    buttonToggled: !indexActiveAfter && valueActiveAfter,
    rectsChanged: sortChanged,
    animated: positionTransitions3.length > 0,
  },
  test4_sortToIndex: {
    buttonToggled: indexActiveFinal && !valueActiveFinal,
    animated: positionTransitions4.length > 0,
  },
};

console.log('\n=== FINAL RESULT ===');
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(
  errors.length > 0 ||
  !result.test1_orientationToHorizontal.buttonToggled ||
  !result.test1_orientationToHorizontal.animated ||
  !result.test2_orientationToVertical.buttonToggled ||
  !result.test2_orientationToVertical.animated ||
  !result.test3_sortToValue.buttonToggled ||
  !result.test3_sortToValue.animated ||
  !result.test4_sortToIndex.buttonToggled ||
  !result.test4_sortToIndex.animated
    ? 1 : 0
);
