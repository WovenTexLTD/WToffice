/**
 * Photograph the office.
 *
 * The reason this exists: furniture was being placed by whoever could not see
 * the result, chosen from a bounding box and a filename. A bean bag turned out
 * to be a ball and a daybed turned out to be pink. Guessing is not a workflow.
 *
 *   npm run shoot                     # whole floor
 *   npm run shoot -- --at 1180,1070   # centred on a point, closer in
 *   npm run shoot -- --at 900,520 --dist 700 --out desks.png
 *
 * Writes to shots/ (gitignored). The dev server must be running.
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** Photograph the model catalogue instead of the office. */
const models = flag("models", null);
const at = flag("at", null);
const dist = Number(flag("dist", at ? 900 : 2600));
const out = flag("out", "shots/office.png");
const url = flag("url", "http://localhost:3000");

await mkdir("shots", { recursive: true });

const browser = await chromium.launch({
  args: [
    // SwiftShader gives headless Chromium a working WebGL implementation.
    // Without it the canvas comes back blank and the whole exercise is moot.
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
  ],
});

const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  // Granted so the app takes its normal path rather than its denied-mic path.
  permissions: ["microphone", "camera"],
});

const page = await context.newPage();
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(m.text());
});
page.on("pageerror", (e) => problems.push(String(e)));

if (models) {
  // The catalogue, filtered. This is how furniture gets chosen by looking at it
  // rather than by reading a bounding box off a filename.
  await page.goto(`${url}/catalogue`, { waitUntil: "networkidle" });
  await page.fill('input[placeholder^="Search"]', models);
  // Thumbnails render lazily and queue behind one another.
  await page.waitForTimeout(1000 + 500 * Math.min(24, Number(flag("count", 24))));
  await page.screenshot({ path: out });
  console.log(`\nwrote ${out}`);
  await browser.close();
  process.exit(0);
}

await page.goto(url, { waitUntil: "networkidle" });

// Walk in.
await page.fill("#name", "camera");
// noWaitAfter because this form never navigates — it swaps the React tree in
// place. Playwright otherwise blocks on a navigation that will never happen,
// and under the dev server's hot reload that turns into a flat 15s timeout.
await page.click('button[type="submit"]', { timeout: 15000, noWaitAfter: true });
// Generous, because the dev server recompiles the shared floor module on every
// edit and the first load after one is slow. Failing here used to abort with a
// bare Playwright timeout and throw away every console error the page had
// already reported, which is exactly the information needed to tell "still
// compiling" apart from "the scene threw".
// waitForFunction rather than waitForSelector: under hot reload the canvas is
// unmounted and remounted, so a locator handle goes stale over and over and
// never settles even though a canvas is on the page the whole time. Asking the
// DOM a question each poll has no handle to go stale.
try {
  await page.waitForFunction(
    () => {
      const c = document.querySelector("canvas");
      return !!c && c.clientWidth > 0;
    },
    null,
    { timeout: 60000, polling: 250 },
  );
} catch (error) {
  console.log("\nno canvas after 60s");
  for (const p of problems.slice(0, 8)) console.log("  " + p);
  throw error;
}
console.log("  canvas up");

// Confirm WebGL actually initialised. Headless Chromium without a working
// SwiftShader pipeline yields a canvas that never draws, and every screenshot
// after that is a convincing blank rectangle.
const gl = await page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  const context = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
  if (!context) return null;
  const info = context.getExtension("WEBGL_debug_renderer_info");
  return info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown renderer";
});
console.log("  webgl:", gl ?? "NOT AVAILABLE");

// Models load asynchronously and replace their placeholders; a fixed wait is
// crude but the scene reports nothing better, and the alternative is
// photographing a room half full of grey blocks.
await page.waitForTimeout(6000);

// Frame the shot by driving the camera directly, so a photograph can be taken
// of anywhere on the floor without walking there.
await page.evaluate(
  ({ at, dist }) => {
    const scene = window.__officeScene;
    if (!scene) return;
    if (at) {
      const [x, y] = at.split(",").map(Number);
      scene.lookAtPoint(x, y, dist);
    } else {
      scene.frameAll();
    }
  },
  { at, dist },
);
// Hide the interface, but not the people. A chat panel down one side is a
// third of the frame and a distraction; the avatars are the subject, and
// judging a room's composition without them is how furniture ends up sized
// against nothing.
await page.addStyleTag({
  content: ".hud, .panel, .banner, .knocks, .diag { display: none !important; }",
});

await page.waitForTimeout(700);

// The page, not the canvas element. A locator screenshot waits for its target
// to stop moving, and a canvas rendering at 60fps never does.
// 3200x2000 through SwiftShader is a slow capture, and slower again while the
// dev server is recompiling in the background. The default 30s is not enough.
await page.screenshot({ path: out, timeout: 120000 });
console.log(`\nwrote ${out}`);
if (problems.length) {
  console.log("\npage errors:");
  for (const p of problems.slice(0, 8)) console.log("  " + p);
}

await browser.close();
