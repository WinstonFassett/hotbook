// capture-helpers.mjs — shared capture plumbing for smoke tests.
//
// Writes to dogfood-output/ (gitignored) so you can watch what passed:
//   dogfood-output/screenshots/<scenario>/before.png
//   dogfood-output/screenshots/<scenario>/during.png
//   dogfood-output/screenshots/<scenario>/after.png
//   dogfood-output/videos/<scenario>/run.webm
//
// Usage:
//   import { startCapture, snapshot, finishCapture } from './capture-helpers.mjs';
//   const cap = await startCapture('scenario-7-cross-tile');
//   ... await snapshot(cap, 'before'); ...
//   await finishCapture(cap);

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..'); // repo root
const SHOTS = join(ROOT, 'dogfood-output', 'screenshots');
const VIDEOS = join(ROOT, 'dogfood-output', 'videos');

const BASE_URL = process.env.HARNESS_URL || 'http://localhost:8765/';

/**
 * Launch browser + video-recording context, navigate to the harness, settle.
 * Returns { page, ctx, browser, scenario, shotDir, videoDir, errors }.
 */
export async function startCapture(scenario, { viewport = { width: 1200, height: 700 }, settleMs = 1500 } = {}) {
  const shotDir = join(SHOTS, scenario);
  const videoDir = join(VIDEOS, scenario);
  mkdirSync(shotDir, { recursive: true });
  mkdirSync(videoDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: viewport.width, height: viewport.height } },
    viewport,
  });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(settleMs);

  return { page, ctx, browser, scenario, shotDir, videoDir, errors };
}

/** Save a named PNG (e.g. 'before' | 'during' | 'after') into the scenario's shot dir. */
export async function snapshot(cap, label) {
  await cap.page.screenshot({ path: join(cap.shotDir, `${label}.png`), fullPage: false });
}

/**
 * Close context (flushes video), rename the recorded webm to run.webm, close browser.
 * Returns the final video path.
 */
export async function finishCapture(cap) {
  await cap.ctx.close();
  let videoPath = null;
  const video = cap.page.video();
  if (video) {
    const raw = await video.path();
    const target = join(cap.videoDir, 'run.webm');
    const { renameSync } = await import('fs');
    try { renameSync(raw, target); videoPath = target; }
    catch (e) {
      // Fall back to copy if rename crosses devices.
      try {
        const { copyFileSync, unlinkSync } = await import('fs');
        copyFileSync(raw, target);
        unlinkSync(raw);
        videoPath = target;
      } catch (e2) {
        console.error('video rename/copy failed:', e2.message);
        videoPath = raw;
      }
    }
  }
  await cap.browser.close();
  return { videoPath, errors: cap.errors };
}
