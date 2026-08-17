/**
 * Measure the office.
 *
 * Reports what the renderer is asked to do per frame and how long frames take.
 * The absolute frame rate here is meaningless — this runs on a software
 * renderer — but draw calls, triangles and the shape of the shadow pass are
 * real, and so is the difference between two runs.
 *
 *   npm run perf
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

// The office is password-protected; without this the probe measures an empty
// scene and reports that everything is wonderfully fast.
for (const path of ["./.env", "../.env"]) {
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}

const url = process.argv.includes("--url")
  ? process.argv[process.argv.indexOf("--url") + 1]
  : "http://localhost:3000";

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await (await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ["microphone", "camera"],
})).newPage();

await page.goto(url, { waitUntil: "networkidle" });
await page.fill("#name", "Perf");
const pw = page.locator("#office-key");
if (await pw.count()) await pw.fill(process.env.OFFICE_KEY ?? "");
await page.waitForTimeout(300);
await page.click('button[type="submit"]', { noWaitAfter: true });
await page.waitForFunction(() => {
  const c = document.querySelector("canvas");
  return !!c && c.clientWidth > 0;
}, null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(9000);

// Walk, so the measurement covers a moving camera rather than a still one.
const result = await page.evaluate(async () => {
  const scene = window.__officeScene;
  const frames = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    if (frames.length < 240) requestAnimationFrame(tick);
  };

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
  requestAnimationFrame(tick);
  await new Promise((r) => setTimeout(r, 8000));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));

  frames.sort((a, b) => a - b);
  const median = frames[Math.floor(frames.length / 2)] ?? 0;
  const worst = frames[frames.length - 1] ?? 0;
  const stats = scene.stats();
  if (!stats.objects) throw new Error("the world is empty — did the join succeed?");
  return { ...stats, medianMs: +median.toFixed(1), worstMs: +worst.toFixed(1) };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
