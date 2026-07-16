// smoke-cross-tile.mjs — cross-tile editing test using page.mouse.
// Proves: drag in table → icicle shows draft, status drafting, commit writes, Esc reverts.
// Captures: dogfood-output/screenshots/scenario-7-cross-tile/{before,during,after}.png
//           dogfood-output/videos/scenario-7-cross-tile/run.webm

import { startCapture, snapshot, finishCapture } from './capture-helpers.mjs';

const cap = await startCapture('scenario-7-cross-tile');
const { page, errors } = cap;

// Helper: get the value cell for a node
async function getValCell(nodeId) {
  const cells = await page.locator(`v-side-table div[data-id="${nodeId}"]`).all();
  for (const cell of cells) {
    const text = await cell.textContent();
    if (text && /^\d+$/.test(text.trim())) return cell;
  }
  return null;
}

// Helper: capture all icicle rect positions (for siblings-frozen check)
async function getRectPositions() {
  return await page.$$eval('v-icicle rect[data-id]', els =>
    els.map(e => ({
      id: e.getAttribute('data-id'),
      x: parseFloat(e.getAttribute('x')),
      y: parseFloat(e.getAttribute('y')),
      w: parseFloat(e.getAttribute('width')),
      h: parseFloat(e.getAttribute('height')),
    }))
  );
}

// === Test 1: Cross-tile drag edit ===
console.log('=== Test 1: Cross-tile drag edit ===');

const rentCell = await getValCell('rent');
const box = await rentCell.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

// Capture sibling positions before gesture
const positionsBefore = await getRectPositions();
const housingBefore = positionsBefore.find(p => p.id === 'housing');
const foodBefore = positionsBefore.find(p => p.id === 'food');
await snapshot(cap, 'before');

// Start drag — down, then move to start the gesture
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.waitForTimeout(50);
// First move starts the draft
await page.mouse.move(cx, cy - 10, { steps: 2 });
await page.waitForTimeout(200);

const statusDuring = await page.locator('#icicle-status').textContent();
const draftCount = await page.locator('v-icicle rect[data-draft]').count();
console.log(`  During drag: status=${statusDuring}, draft overlay=${draftCount}`);

// Move up 50px (increase value)
await page.mouse.move(cx, cy - 50, { steps: 5 });
await page.waitForTimeout(200);

const valDuring = await rentCell.textContent();

// Capture sibling positions during gesture
const positionsDuring = await getRectPositions();
const housingDuring = positionsDuring.find(p => p.id === 'housing');
const foodDuring = positionsDuring.find(p => p.id === 'food');

const siblingsFrozen =
  housingDuring.x === housingBefore.x &&
  housingDuring.y === housingBefore.y &&
  housingDuring.w === housingBefore.w &&
  housingDuring.h === housingBefore.h &&
  foodDuring.x === foodBefore.x &&
  foodDuring.y === foodBefore.y &&
  foodDuring.w === foodBefore.w &&
  foodDuring.h === foodBefore.h;

console.log(`  Value during: ${valDuring}`);
console.log(`  Siblings frozen: ${siblingsFrozen}`);
await snapshot(cap, 'during');

// Release
await page.mouse.up();
await page.waitForTimeout(500);

const statusAfter = await page.locator('#icicle-status').textContent();
const rentCellAfter = await getValCell('rent');
const valAfter = await rentCellAfter.textContent();
const draftAfter = await page.locator('v-icicle rect[data-draft]').count();
console.log(`  After commit: status=${statusAfter}, value=${valAfter}, draft=${draftAfter}`);
await snapshot(cap, 'after-commit');

// === Test 2: Esc revert ===
console.log('\n=== Test 2: Esc revert ===');
const committedVal = parseInt(valAfter);
const rentCell2 = await getValCell('rent');
const box2 = await rentCell2.boundingBox();
const cx2 = box2.x + box2.width / 2;
const cy2 = box2.y + box2.height / 2;

await page.mouse.move(cx2, cy2);
await page.mouse.down();
await page.waitForTimeout(200);
await page.mouse.move(cx2, cy2 - 80, { steps: 5 });
await page.waitForTimeout(200);

const valBeforeEsc = await rentCell2.textContent();
const statusBeforeEsc = await page.locator('#icicle-status').textContent();
console.log(`  Before Esc: value=${valBeforeEsc}, status=${statusBeforeEsc}`);

// Press Escape
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

const rentCellAfterEsc = await getValCell('rent');
const valAfterEsc = await rentCellAfterEsc.textContent();
const statusAfterEsc = await page.locator('#icicle-status').textContent();
console.log(`  After Esc: value=${valAfterEsc}, status=${statusAfterEsc}`);
await snapshot(cap, 'after-esc');

// Send pointerup to clean up the drag listeners (Esc cancelled, so no commit)
await page.mouse.up();
await page.waitForTimeout(200);

// === Results ===
const result = {
  errors,
  test1_crossTile: {
    dragStarted: statusDuring === 'drafting',
    draftOverlayOnIcicle: draftCount > 0,
    valueChanged: valDuring !== '2200',
    siblingsFrozen,
    committed: statusAfter === 'idle',
    valueWritten: valAfter !== '2200',
    draftCleared: draftAfter === 0,
  },
  test2_escRevert: {
    dragStarted: statusBeforeEsc === 'drafting',
    revertedToCommitted: valAfterEsc === String(committedVal),
    statusIdle: statusAfterEsc === 'idle',
  },
};

console.log('\n=== FINAL RESULT ===');
console.log(JSON.stringify(result, null, 2));

const { videoPath } = await finishCapture(cap);
console.log(`captured: ${cap.shotDir}/*.png, ${videoPath}`);
process.exit(
  errors.length > 0 ||
  !result.test1_crossTile.dragStarted ||
  !result.test1_crossTile.siblingsFrozen ||
  !result.test1_crossTile.committed ||
  !result.test2_escRevert.revertedToCommitted
    ? 1 : 0
);
