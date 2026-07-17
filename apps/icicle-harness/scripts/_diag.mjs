import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
await page.goto('http://localhost:8765/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const data = await page.evaluate(() => {
  const g = document.querySelector('v-icicle g[data-id="housing"]');
  const outer = g.parentElement;
  const children = Array.from(outer.children).map(c => ({
    tag: c.tagName,
    dataId: c.getAttribute('data-id'),
    transform: c.style.transform || c.getAttribute('transform'),
    clipPath: c.getAttribute('clip-path') || c.querySelector('[clip-path]')?.getAttribute('clip-path'),
    text: c.querySelector('text')?.textContent?.slice(0,10),
    textRect: c.querySelector('text')?.getBoundingClientRect(),
  }));
  // Check clip rect
  const cp = document.getElementById('clip-housing');
  const cr = cp?.querySelector('rect');
  return {
    children,
    clipRect: cr ? { x: cr.getAttribute('x'), y: cr.getAttribute('y'), w: cr.getAttribute('width'), h: cr.getAttribute('height') } : null,
  };
});
console.log(JSON.stringify(data, null, 2));
await browser.close();
