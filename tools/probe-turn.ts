/**
 * Does the relay actually reach the browser?
 *
 * Starts a server of its own on a spare port — once with TURN configured and
 * once without — and reads the welcome frame each time. Its own server rather
 * than the one you have running, so the answer does not depend on what happens
 * to be in your .env.
 *
 *   npx tsx tools/probe-turn.ts
 */

import { spawn } from "node:child_process";
import WebSocket from "ws";
import type { ServerMessage } from "../shared/src/index";

const PORT = 3997;
let failures = 0;

function check(label: string, pass: boolean, detail = ""): void {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

/** Start a server, wait for it to say it is listening, and hand it back. */
async function startServer(env: Record<string, string>) {
  const child = spawn("npx", ["tsx", "server/src/index.ts"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      // Its own database, so a probe never touches the real one.
      DB_PATH: ":memory:",
      OFFICE_KEY: "",
      NOTION_TOKEN: "",
      // Cleared unless this run sets them, so a stale shell cannot pass a test.
      TURN_URLS: "",
      TURN_USERNAME: "",
      TURN_CREDENTIAL: "",
      TURN_KEY_ID: "",
      TURN_KEY_API_TOKEN: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines: string[] = [];
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server never started:\n${lines.join("\n")}`)), 30000);
    const watch = (chunk: Buffer) => {
      const text = String(chunk);
      lines.push(text.trimEnd());
      if (text.includes("office server →")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", watch);
    child.stderr.on("data", watch);
  });

  await ready;
  return { child, lines };
}

/** Walk in and return the greeting. */
async function welcome(): Promise<Extract<ServerMessage, { t: "welcome" }>> {
  const socket = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ t: "join", name: "Probe" }));

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no welcome")), 10000);
    socket.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (msg.t !== "welcome") return;
      clearTimeout(timer);
      socket.close();
      resolve(msg);
    });
  });
}

async function main(): Promise<void> {
  console.log("\nTURN\n");

  /* Configured: the relay is handed out with the greeting. */
  {
    const { child, lines } = await startServer({
      TURN_URLS: "turn:relay.example.com:3478,turns:relay.example.com:5349",
      TURN_USERNAME: "office",
      TURN_CREDENTIAL: "hunter2",
    });
    // The banner is printed after listening, so give it the same tick.
    await new Promise((r) => setTimeout(r, 300));

    const greeting = await welcome();
    const ice = greeting.ice ?? [];
    const relay = ice.find((s) => s.urls.some((u) => u.startsWith("turn")));

    check("the greeting carries a relay", relay !== undefined);
    check("both of its addresses arrive", relay?.urls.length === 2, relay?.urls.join(" "));
    check("with its credentials", relay?.username === "office" && relay?.credential === "hunter2");
    check(
      "STUN comes too, so a direct path is still preferred",
      ice.some((s) => s.urls.some((u) => u.startsWith("stun"))),
    );
    check(
      "the server says so on start-up",
      lines.some((l) => l.includes("TURN relay configured (static credentials)")),
    );
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
  }

  /* Half-configured: urls but no credentials is a mistake, not a relay. */
  {
    const { child, lines } = await startServer({ TURN_URLS: "turn:relay.example.com:3478" });
    await new Promise((r) => setTimeout(r, 300));

    const ice = (await welcome()).ice ?? [];
    check(
      "urls without credentials are refused rather than half-used",
      !ice.some((s) => s.urls.some((u) => u.startsWith("turn"))),
    );
    check(
      "and it says why",
      lines.some((l) => l.includes("ignoring")),
    );
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
  }

  /* Unconfigured: exactly what the office did before any of this existed. */
  {
    const { child, lines } = await startServer({});
    await new Promise((r) => setTimeout(r, 300));

    const ice = (await welcome()).ice ?? [];
    check("no relay configured means no relay sent", !ice.some((s) => s.urls.some((u) => u.startsWith("turn"))));
    check("STUN still is", ice.some((s) => s.urls.some((u) => u.startsWith("stun"))));
    check(
      "and the start-up banner warns about it",
      lines.some((l) => l.includes("STUN only")),
    );
    child.kill();
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);

}

void main();
