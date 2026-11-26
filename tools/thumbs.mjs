// Renders the thumbnails in viewer/public/thumbs/ from the scene itself:
// the scene picker tiles and the glider cards in the Customize panel.
// Start the viewer first (npm run dev), then: node tools/thumbs.mjs [base-url]
// Needs Playwright with Chromium, and Python 3 with Pillow to shrink the images.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://localhost:5180/';
const out = fileURLToPath(new URL('../viewer/public/thumbs/', import.meta.url));
mkdirSync(out, { recursive: true });
// A card for every glider in the list (Settings, and the comparison's "Compare with" panel).
const models = JSON.parse(readFileSync(new URL('../viewer/public/models.json', import.meta.url))).models.map((m) => m.id);
const jobs = [
  ...['studio', 'hangar', 'hill'].map((id) => ({ name: `scene-${id}`, q: `thumb=scene:${id}&model=opus`, w: 240, h: 172 })),
  ...models.map((id) => ({ name: `model-${id}`, q: `thumb=model:${id}&model=${id}`, w: 240, h: 140 })),
];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const job of jobs) {
  // Render at twice the size and shrink, for clean edges on thin wires.
  const page = await browser.newPage({ viewport: { width: job.w * 2, height: job.h * 2 }, deviceScaleFactor: 1 });
  await page.goto(`${base}?${job.q}`);
  await page.waitForSelector('body[data-thumb-ready]', { timeout: 300000 });
  const png = `${out}${job.name}.png`;
  await page.screenshot({ path: png });
  await page.close();
  execFileSync('python3', ['-c', `from PIL import Image; import os; im = Image.open('${png}').convert('RGB').resize((${job.w}, ${job.h}), Image.LANCZOS); im.save('${out}${job.name}.jpg', quality=84, optimize=True); os.remove('${png}')`]);
  console.log('wrote', `${job.name}.jpg`);
}
// The gliders seen from above, for the comparison's "Compare with" list: the page draws the picture itself.
for (const id of models) {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  await page.goto(`${base}?model=${id}&snap=1`);
  await page.waitForSelector('body[data-snap]', { timeout: 300000 });
  const url = await page.evaluate(() => document.body.dataset.snap);
  await page.close();
  writeFileSync(`${out}top-${id}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', `top-${id}.jpg`);
}
await browser.close();
