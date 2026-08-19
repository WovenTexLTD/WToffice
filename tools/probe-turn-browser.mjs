/**
 * The other half of tools/probe-turn.ts: the server sends a relay, but does the
 * browser build its connections with it?
 *
 * Runs a server of its own with TURN configured, joins in a real browser, and
 * wraps RTCPeerConnection before any application code runs so every
 * configuration it is constructed with is recorded. A second participant joins
 * over a plain socket — no second browser, which is more than one machine will
 * software-render — because a peer connection is built the moment somebody else
 * is in the room, whether or not they ever answer.
 *
 *   node tools/probe-turn-browser.mjs
 */

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import WebSocket from "ws";

for (const p of ["./.env"]) if (existsSync(p)) process.loadEnvFile(p);

const PORT = 3001; // The web app's development build looks here and nowhere else.
const RELAY = "turn:relay.example.invalid:3478";
let failures = 0;
const check = (label, pass, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};

const server = spawn("npx", ["tsx", "server/src/index.ts"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DB_PATH: ":memory:",
    TURN_URLS: RELAY,
    TURN_USERNAME: "office",
    TURN_CREDENTIAL: "hunter2",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server never started")), 30000);
  const watch = (c) => String(c).includes("office server →") && (clearTimeout(timer), resolve());
  server.stdout.on("data", watch);
  server.stderr.on("data", watch);
});

const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1100, height: 700 },
  permissions: ["camera", "microphone"],
});

// Before the app loads, so nothing it builds is missed.
await context.addInitScript(() => {
  window.__pcConfigs = [];
  const Real = window.RTCPeerConnection;
  window.RTCPeerConnection = function (config, ...rest) {
    window.__pcConfigs.push(JSON.parse(JSON.stringify(config ?? {})));
    return new Real(config, ...rest);
  };
  window.RTCPeerConnection.prototype = Real.prototype;
});

const page = await context.newPage();
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.fill("#name", "Karim");
const pw = page.locator("#office-key");
if (await pw.count()) await pw.fill(process.env.OFFICE_KEY ?? "");
await page.click('button[type="submit"]', { noWaitAfter: true });
await page.waitForFunction(() => !!document.querySelector("canvas"), null, {
  timeout: 90000,
  polling: 250,
});
await page.waitForTimeout(3000);

// Somebody to connect to. Never answers, which does not matter: the connection
// is constructed — with whatever configuration it was given — regardless.
const other = new WebSocket(`ws://localhost:${PORT}`);
await new Promise((r) => other.once("open", r));
other.send(JSON.stringify({ t: "join", name: "ABD", key: process.env.OFFICE_KEY ?? "" }));
await page.waitForTimeout(5000);

const configs = await page.evaluate(() => window.__pcConfigs ?? []);
const built = configs.at(-1);
const servers = built?.iceServers ?? [];
const relay = servers.find((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.includes("relay.example.invalid")));

check("the browser built a peer connection", configs.length > 0, `${configs.length} built`);
check("configured with the relay the server sent", relay !== undefined);
check("carrying its credentials", relay?.username === "office" && relay?.credential === "hunter2");
check(
  "and still with STUN, so a direct path is tried first",
  servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith("stun"))),
);

other.close();
await browser.close();
server.kill();

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
