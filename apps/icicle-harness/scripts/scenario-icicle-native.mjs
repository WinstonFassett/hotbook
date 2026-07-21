// smoke-icicle-icicle.mjs — icicle-native edit surfaces (wheel + keyboard).
// Proves: wheel on icicle leaf → drafting, siblings frozen, commit writes;
//         keyboard arrow on focused tile → drafting, Esc reverts.
//
// Tests scenarios 2 (wheel additive, siblings frozen) and 3 (keyboard + Esc)
// from wiki/handoff-icicle-impl.md, but scoped to the icicle's own surfaces.
//
// Captures: dogfood-output/screenshots/scenario-2-3-icicle-native/{wheel-before,wheel-during,wheel-after,kbd-before,kbd-during,kbd-after,esc-before,esc-after}.png
//           dogfood-output/videos/scenario-2-3-icicle-native/run.webm

import { startCapture, snapshot, finishCapture } from './capture-helpers.mjs';

const cap = await startCapture('scenario-2-3-icicle-native');
const { page, errors } = cap;

// All icicle tile rects (excludes draft overlay, which carries data-draft).
async function getRectPositions() {
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

function positionsEqual(a, b) {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

// Assert every rect except the edited one is frozen.
function siblingsFrozen(before, after, editedId) {
  const beforeMap = new Map(before.map(p => [p.id, p]));
  for (const p of after) {
    if (p.id === editedId) continue;
    const b = beforeMap.get(p.id);
    if (!b || !positionsEqual(b, p)) return false;
  }
  return true;
}

async function statusText() {
  return await page.locator('#icicle-status').textContent();
}

// === Test 1: Wheel on icicle leaf (ctrl+wheel = additive) ===
console.log('=== Test 1: Wheel on icicle leaf (additive, siblings frozen) ===');

// Target 'rent' leaf. Get its rect center in screen coords.
let positions = await getRectPositions();
const rentRect = positions.find(p => p.id === 'rent');
if (!rentRect) { console.error('rent rect not found'); await browser.close(); process.exit(1); }

// SVG viewBox is 0 0 720 480; the SVG fills its container. Get the SVG's
// bounding box to map viewBox coords → screen coords.
const svgBox = await page.locator('v-icicle svg').boundingBox();
const vbW = 720, vbH = 480;
const scale = svgBox.width / vbW;
const rentCx = svgBox.x + (rentRect.x + rentRect.w / 2) * scale;
const rentCy = svgBox.y + (rentRect.y + rentRect.h / 2) * scale;

// Read committed value of rent from the table (source of truth).
async function tableVal(id) {
  const cells = await page.locator(`v-side-table div[data-id="${id}"]`).all();
  for (const cell of cells) {
    const text = await cell.textContent();
    if (text && /^\d+$/.test(text.trim())) return parseInt(text.trim());
  }
  return null;
}

const rentBefore = await tableVal('rent');
const positionsBefore = await getRectPositions();
console.log(`  rent committed value: ${rentBefore}`);
await snapshot(cap, 'wheel-before');

// Move over the rent tile, hold Control, wheel up (increase).
await page.mouse.move(rentCx, rentCy);
await page.keyboard.down('Control');
await page.mouse.wheel(0, -300);  // deltaY negative = scroll up = increase
await page.waitForTimeout(150);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(200);
await page.keyboard.up('Control');
await page.waitForTimeout(150);

const statusDuring = await statusText();
const draftCount = await page.locator('v-icicle rect[data-draft]').count();
const positionsDuring = await getRectPositions();
console.log(`  During wheel: status=${statusDuring}, draft overlay=${draftCount}`);

// Siblings-frozen check: every non-rent tile unchanged.
const frozen = siblingsFrozen(positionsBefore, positionsDuring, 'rent');
console.log(`  Siblings frozen during wheel draft: ${frozen}`);
await snapshot(cap, 'wheel-during');

// Wheel drafts don't auto-commit (no keyup analogue). Cancel with Esc to
// return to a clean baseline for the keyboard test.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const statusAfterCancel = await statusText();
console.log(`  After Esc: status=${statusAfterCancel}`);
await snapshot(cap, 'wheel-after');

// === Test 2: Keyboard arrow on focused icicle tile ===
console.log('\n=== Test 2: Keyboard arrow on focused tile (additive, Esc reverts) ===');

// Click rent tile to focus the icicle host.
await page.mouse.move(rentCx, rentCy);
await page.mouse.click(rentCx, rentCy);
await page.waitForTimeout(150);

const rentBeforeKbd = await tableVal('rent');
const positionsBeforeKbd = await getRectPositions();
console.log(`  rent committed value: ${rentBeforeKbd}`);
await snapshot(cap, 'kbd-before');

// ArrowUp = additive increase. Hold to draft, then release to commit.
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(200);

const statusDuringKbd = await statusText();
const draftKbd = await page.locator('v-icicle rect[data-draft]').count();
const positionsDuringKbd = await getRectPositions();
console.log(`  During ArrowUp: status=${statusDuringKbd}, draft overlay=${draftKbd}`);
const frozenKbd = siblingsFrozen(positionsBeforeKbd, positionsDuringKbd, 'rent');
console.log(`  Siblings frozen during keyboard draft: ${frozenKbd}`);
await snapshot(cap, 'kbd-during');

// Release ArrowUp → commits.
await page.keyboard.up('ArrowUp');
await page.waitForTimeout(400);

const statusAfterCommit = await statusText();
const rentAfterCommit = await tableVal('rent');
const draftAfterCommit = await page.locator('v-icicle rect[data-draft]').count();
console.log(`  After ArrowUp release: status=${statusAfterCommit}, rent=${rentAfterCommit}, draft=${draftAfterCommit}`);
await snapshot(cap, 'kbd-after');

// === Test 3: Keyboard + Esc revert ===
console.log('\n=== Test 3: Keyboard arrow then Esc reverts ===');

const baseline = await tableVal('rent');
await page.mouse.click(rentCx, rentCy);
await page.waitForTimeout(100);
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(200);
const duringDraft = await tableVal('rent');
const statusDuring3 = await statusText();
console.log(`  Before Esc: rent=${duringDraft}, status=${statusDuring3}`);
await snapshot(cap, 'esc-before');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// Release the held ArrowUp (Esc cancelled; keyup guard prevents commit).
await page.keyboard.up('ArrowUp');
await page.waitForTimeout(200);
const afterEsc = await tableVal('rent');
const statusAfterEsc = await statusText();
console.log(`  After Esc: rent=${afterEsc}, status=${statusAfterEsc}`);
await snapshot(cap, 'esc-after');

// === Results ===
const result = {
  errors,
  test1_wheel: {
    drafted: statusDuring === 'drafting',
    draftOverlayShown: draftCount > 0,
    siblingsFrozen: frozen,
    cancelledClean: statusAfterCancel === 'idle',
  },
  test2_keyboard: {
    drafted: statusDuringKbd === 'drafting',
    draftOverlayShown: draftKbd > 0,
    siblingsFrozen: frozenKbd,
    committed: statusAfterCommit === 'idle',
    valueWritten: rentAfterCommit !== rentBeforeKbd,
    draftCleared: draftAfterCommit === 0,
  },
  test3_keyboardEsc: {
    drafted: statusDuring3 === 'drafting',
    revertedToCommitted: afterEsc === baseline,
    statusIdle: statusAfterEsc === 'idle',
  },
};

console.log('\n=== FINAL RESULT ===');
console.log(JSON.stringify(result, null, 2));

const { videoPath } = await finishCapture(cap);
console.log(`captured: ${cap.shotDir}/*.png, ${videoPath}`);
process.exit(
  errors.length > 0 ||
  !result.test1_wheel.drafted ||
  !result.test1_wheel.siblingsFrozen ||
  !result.test1_wheel.cancelledClean ||
  !result.test2_keyboard.drafted ||
  !result.test2_keyboard.siblingsFrozen ||
  !result.test2_keyboard.committed ||
  !result.test2_keyboard.valueWritten ||
  !result.test3_keyboardEsc.revertedToCommitted
    ? 1 : 0
);
