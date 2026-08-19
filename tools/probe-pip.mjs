/**
 * Does the pop-out actually pop out, and does it survive tabbing away?
 *
 * Joins with a fake camera, clicks the button, and reads the window that opens
 * from the inside — tiles, bound streams, whether the picture is moving. Then
 * marks the page hidden and checks two things that used to stop: the video, and
 * the world behind it, which has to keep running or nobody new ever appears.
 *
 *   node tools/probe-pip.mjs [--headed]
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

for (const p of ["./.env", "../.env"]) if (existsSync(p)) { process.loadEnvFile(p); break; }

const URL = process.env.PROBE_URL ?? "http://localhost:3000";
const HEADLESS = process.argv.includes("--headed") ? false : true;

const browser = await chromium.launch({
  // The headless shell has no windowing, and Document PiP is a window: it has
  // to be full Chrome, headed or in the new headless mode.
  channel: "chromium",
  headless: HEADLESS,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});

async function join(name) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["microphone", "camera"],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

  // Movement frames, so we can tell whether the world still turns while hidden.
  const moves = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      if (typeof f.payload === "string" && f.payload.includes('"move"')) moves.push(Date.now());
    }),
  );

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.fill("#name", name);
  const pw = page.locator("#office-key");
  if (await pw.count()) await pw.fill(process.env.OFFICE_KEY ?? "");
  await page.click('button[type="submit"]', { timeout: 15000, noWaitAfter: true });
  try {
    await page.waitForFunction(() => !!document.querySelector("canvas"), null, {
      timeout: 60000,
      polling: 250,
    });
  } catch (e) {
    console.log(`${name} never got a canvas. Page says:`);
    console.log((await page.locator("body").innerText()).slice(0, 600));
    console.log("errors:", errors.slice(0, 6));
    throw e;
  }
  return { page, errors, moves };
}

// One participant. Two software-rendered offices on one machine is more than
// this machine will do, and the pop-out is filled from the same pass that fills
// the floor tiles — so a live self view exercises the whole path.
const a = await join("Karim");
await a.page.waitForTimeout(4000);

console.log("supported:", await a.page.evaluate(() => "documentPictureInPicture" in window));
console.log("button present:", await a.page.locator('button:has-text("Pop out faces")').count());

// Camera on, so there is something to show.
const cam = a.page.locator('button:has-text("Camera")').first();
if (await cam.count()) await cam.click();
await a.page.waitForTimeout(6000);

await a.page.click('button:has-text("Pop out faces")');
await a.page.waitForTimeout(3000);

const report = await a.page.evaluate(() => {
  const win = window.documentPictureInPicture?.window;
  if (!win) return { opened: false };
  const videos = [...win.document.querySelectorAll("video")];
  return {
    opened: true,
    title: win.document.title,
    tiles: win.document.querySelectorAll(".face").length,
    names: [...win.document.querySelectorAll(".name")].map((n) => n.textContent),
    empty: !!win.document.querySelector(".empty"),
    videos: videos.map((v) => ({
      bound: !!v.srcObject,
      w: v.videoWidth,
      h: v.videoHeight,
      paused: v.paused,
      muted: v.muted,
      mirrored: v.style.transform,
    })),
  };
});
console.log("pop-out:", JSON.stringify(report, null, 2));

// Walk somewhere, then hide the tab mid-stride. Before the background driver
// existed the avatar froze on the spot, because the loop that moves it only ran
// under requestAnimationFrame.
await a.page.mouse.click(340, 300);

await a.page.evaluate(() => {
  Object.defineProperty(document, "hidden", { value: true, configurable: true });
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
const hiddenAt = Date.now();
await a.page.waitForTimeout(4000);
console.log("move frames sent while hidden:", a.moves.filter((t) => t > hiddenAt + 200).length);
const afterHide = await a.page.evaluate(() => {
  const win = window.documentPictureInPicture?.window;
  const v = win?.document.querySelector("video");
  return { stillOpen: !!win, playing: v ? !v.paused && v.videoWidth > 0 : null, time: v?.currentTime };
});
console.log("while hidden:", JSON.stringify(afterHide));

const errs = a.errors.filter((e) => !/favicon|ResizeObserver/i.test(e));
if (errs.length) console.log("errors:\n  " + errs.slice(0, 8).join("\n  "));
else console.log("no page errors");

await browser.close();
