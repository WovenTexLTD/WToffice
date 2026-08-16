/**
 * Photograph the tasks board.
 *
 * The board only exists while it is open, so the whole-office camera never sees
 * it. This walks in, clicks the tasks button and shoots the overlay — the same
 * reason `shoot.mjs` exists, applied to the one piece of interface that is not
 * on screen by default.
 *
 *   npm run shoot:tasks
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const out = flag("out", "shots/tasks.png");
const url = flag("url", "http://localhost:3000");

await mkdir("shots", { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  permissions: ["microphone", "camera"],
});
const page = await context.newPage();
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(url, { waitUntil: "networkidle" });
await page.fill("#name", flag("name", "Karim"));
await page.click('button[type="submit"]', { timeout: 15000, noWaitAfter: true });

await page.waitForFunction(
  () => {
    const c = document.querySelector("canvas");
    return !!c && c.clientWidth > 0;
  },
  null,
  { timeout: 60000, polling: 250 },
);

// The scene keeps drawing behind the overlay; give it a moment to stop being a
// room full of grey blocks, since the board is photographed over the top of it.
await page.waitForTimeout(6000);

await page.click(".tasks-open");
// The list is a round trip to Notion.
await page.waitForTimeout(6000);

await page.screenshot({ path: out, timeout: 300000 });
console.log(`\nwrote ${out}`);
if (problems.length) {
  console.log("\npage errors:");
  for (const p of problems.slice(0, 6)) console.log("  " + p);
}

await browser.close();
