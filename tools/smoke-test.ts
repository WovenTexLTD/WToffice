/**
 * Smoke test: shared geometry rules, then the live server contract.
 *
 * Start the server first (npm run dev:server), then: npm run smoke
 */

import WebSocket from "ws";
import {
  woventexFloor as floor,
  audioGain,
  resolveMove,
  zoneAt,
  EARSHOT,
  PLAYER_RADIUS,
  type ServerMessage,
} from "../shared/src/index";

const WS_URL = process.env.WS_URL ?? "ws://localhost:3001";

let failures = 0;
function check(label: string, pass: boolean, detail = ""): void {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

/* ── Part A: geometry ────────────────────────────────────────────── */

console.log("\nGeometry\n");

const meetingCentre = { x: 1300, y: 250 };
check("zoneAt finds the meeting room", zoneAt(meetingCentre.x, meetingCentre.y, floor.zones) === "meeting");
check("zoneAt returns null on the open floor", zoneAt(300, 520, floor.zones) === null);
check(
  "a doorway is outside the zone",
  zoneAt(floor.doors[0].x + 7, floor.doors[0].y + 45, floor.zones) === null,
  "you are not in the meeting until you walk in",
);

const open = (x: number, y: number) => ({ x, y, zoneId: null });
const inRoom = (id: string) => ({ x: 1300, y: 250, zoneId: id });

check("same room hears at full volume", audioGain(inRoom("meeting"), inRoom("meeting"), EARSHOT) === 1);
check("different rooms are silent", audioGain(inRoom("meeting"), inRoom("focus"), EARSHOT) === 0);
check("room seals against the open floor", audioGain(inRoom("meeting"), open(1300, 250), EARSHOT) === 0);
check("open floor seals against a room", audioGain(open(1300, 250), inRoom("meeting"), EARSHOT) === 0);
check("touching is full volume", audioGain(open(500, 500), open(500, 500), EARSHOT) === 1);
check("half earshot is half volume", near(audioGain(open(500, 500), open(500 + EARSHOT / 2, 500), EARSHOT), 0.5));
check("beyond earshot is silent", audioGain(open(500, 500), open(500 + EARSHOT + 1, 500), EARSHOT) === 0);

// Sliding: pushing diagonally into a vertical wall should preserve vertical motion.
const slid = resolveMove({ x: 40, y: 500 }, { x: 10, y: 540 }, PLAYER_RADIUS, floor.walls, floor);
check("sliding along a wall preserves the free axis", slid.y > 500, `y moved to ${slid.y.toFixed(1)}`);
check("sliding along a wall blocks the blocked axis", slid.x >= 34, `x held at ${slid.x.toFixed(1)}`);

/* ── Part B: live server ─────────────────────────────────────────── */

interface Client {
  socket: WebSocket;
  id: string;
  inbox: ServerMessage[];
}

function connect(name: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL);
    const client: Client = { socket, id: "", inbox: [] };
    const timer = setTimeout(() => reject(new Error(`${name}: no welcome within 3s`)), 3000);

    socket.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      client.inbox.push(msg);
      if (msg.t === "welcome") {
        client.id = msg.selfId;
        clearTimeout(timer);
        resolve(client);
      }
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.on("open", () => socket.send(JSON.stringify({ t: "join", name })));
  });
}

const move = (c: Client, x: number, y: number) => c.socket.send(JSON.stringify({ t: "move", x, y }));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latestState = (c: Client) => [...c.inbox].reverse().find((m) => m.t === "state");

async function run(): Promise<void> {
  console.log("\nServer\n");

  const alice = await connect("Alice");
  check("client receives welcome with an id", alice.id.length > 0, alice.id);

  const welcome = alice.inbox.find((m) => m.t === "welcome");
  check("welcome carries the floor", welcome?.t === "welcome" && welcome.floor.zones.length === 2);

  const bob = await connect("Bob");
  await wait(200);
  check("existing player is told about the newcomer", alice.inbox.some((m) => m.t === "joined"));

  // Assert membership, not count — a long-running dev server may still hold
  // connections from an earlier run until the heartbeat reaps them.
  const state = latestState(alice);
  const ids = state?.t === "state" ? state.players.map((p) => p.id) : [];
  check(
    "state broadcast lists both players",
    ids.includes(alice.id) && ids.includes(bob.id),
    `saw ${ids.join(", ") || "nobody"}`,
  );

  // Walk left toward the outer wall in realistic steps.
  alice.inbox.length = 0;
  let x = floor.spawn.x;
  for (let i = 0; i < 12; i++) {
    x -= 28;
    move(alice, x, floor.spawn.y);
    await wait(60);
  }
  await wait(250);

  const walked = latestState(alice);
  const aliceState = walked?.t === "state" ? walked.players.find((p) => p.id === alice.id) : undefined;
  const minX = 14 + PLAYER_RADIUS; // wall thickness + body radius
  check(
    "wall stops the player at the correct standoff",
    !!aliceState && aliceState.x >= minX - 1 && aliceState.x <= minX + 3,
    `x = ${aliceState?.x.toFixed(1)}, expected ~${minX}`,
  );

  // A teleport across the map must be rejected and corrected.
  alice.inbox.length = 0;
  move(alice, 1300, 250); // inside the meeting room, ~1000px away
  await wait(250);

  const corrected = alice.inbox.find((m) => m.t === "correct");
  check("teleport is rejected", !!corrected, "server sent a correction");

  const afterTeleport = latestState(alice);
  const aliceNow = afterTeleport?.t === "state" ? afterTeleport.players.find((p) => p.id === alice.id) : undefined;
  check(
    "teleport did not place the player in the sealed room",
    !!aliceNow && aliceNow.zoneId !== "meeting",
    `zone = ${aliceNow?.zoneId ?? "null"}`,
  );

  /* ── Voice: presence and signalling relay ──────────────────────── */

  console.log("\nVoice\n");

  bob.socket.send(JSON.stringify({ t: "presence", speaking: true, muted: false }));
  await wait(250);
  const withPresence = latestState(alice);
  const bobState = withPresence?.t === "state" ? withPresence.players.find((p) => p.id === bob.id) : undefined;
  check("speaking state reaches other clients", bobState?.speaking === true);
  check("muted state defaults false", bobState?.muted === false);

  bob.socket.send(JSON.stringify({ t: "presence", speaking: false, muted: true }));
  await wait(250);
  const afterMute = latestState(alice);
  const bobMuted = afterMute?.t === "state" ? afterMute.players.find((p) => p.id === bob.id) : undefined;
  check("mute propagates", bobMuted?.muted === true && bobMuted?.speaking === false);

  // The server relays signalling verbatim and never joins the call.
  bob.inbox.length = 0;
  const offer = { kind: "offer", sdp: "v=0\r\ns=smoke\r\n" };
  alice.socket.send(JSON.stringify({ t: "signal", to: bob.id, data: offer }));
  await wait(200);

  const relayed = bob.inbox.find((m) => m.t === "signal");
  check("signal reaches the addressed peer", !!relayed);
  check(
    "signal is stamped with the sender",
    relayed?.t === "signal" && relayed.from === alice.id,
    `from = ${relayed?.t === "signal" ? relayed.from : "none"}`,
  );
  check(
    "signal payload is relayed untouched",
    relayed?.t === "signal" && relayed.data.kind === "offer" && relayed.data.sdp === offer.sdp,
  );

  // A signal aimed at nobody must not crash the server or leak to others.
  bob.inbox.length = 0;
  alice.socket.send(JSON.stringify({ t: "signal", to: "p999", data: offer }));
  await wait(200);
  check("signal to an unknown peer is dropped", !bob.inbox.some((m) => m.t === "signal"));
  check("server still alive after a bad signal", !!latestState(alice));

  /* ── Teardown ──────────────────────────────────────────────────── */

  console.log("\nTeardown\n");

  alice.inbox.length = 0;
  bob.socket.close();
  await wait(300);
  check("departure is broadcast", alice.inbox.some((m) => m.t === "left"));

  alice.socket.close();
}

run()
  .then(() => {
    console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("\nsmoke test could not run:", err.message);
    console.error("is the server running? npm run dev:server\n");
    process.exit(1);
  });
