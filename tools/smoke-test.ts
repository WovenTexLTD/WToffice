/**
 * Smoke test: shared geometry rules, then the live server contract.
 *
 * Start the server first (npm run dev:server), then: npm run smoke
 */

import WebSocket from "ws";
import {
  woventexFloor as floor,
  TEAM_CHANNEL,
  audioGain,
  dmChannel,
  toIdentity,
  doorAt,
  resolveMove,
  videoVisible,
  collisionRects,
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

// Derived from the floor rather than written out, because these coordinates
// have now been invalidated three times by rooms moving, and a fixture that
// has to be hand-edited every time the plan changes is a fixture that will
// eventually be edited wrong.
const meetingZone = floor.zones.find((z) => z.id === "meeting")!;
const meetingCentre = { x: meetingZone.x + meetingZone.w / 2, y: meetingZone.y + meetingZone.h / 2 };
check("zoneAt finds the meeting room", zoneAt(meetingCentre.x, meetingCentre.y, floor.zones) === "meeting");
check("zoneAt returns null on the open floor", zoneAt(300, 870, floor.zones) === null);
const meetingDoor = floor.doors.find((d) => d.zoneId === "meeting")!;
check(
  "a doorway is outside the zone",
  zoneAt(meetingDoor.x + 7, meetingDoor.y + 45, floor.zones) === null,
  "you are not in the meeting until you walk in",
);

const open = (x: number, y: number) => ({ x, y, zoneId: null });
const inRoom = (id: string) => ({ x: 2180, y: 300, zoneId: id });

check("same room hears at full volume", audioGain(inRoom("meeting"), inRoom("meeting"), EARSHOT) === 1);
check("different rooms are silent", audioGain(inRoom("meeting"), inRoom("annex"), EARSHOT) === 0);
check("room seals against the open floor", audioGain(inRoom("meeting"), open(2180, 300), EARSHOT) === 0);
check("open floor seals against a room", audioGain(open(2180, 300), inRoom("meeting"), EARSHOT) === 0);
check("touching is full volume", audioGain(open(500, 500), open(500, 500), EARSHOT) === 1);
check("half earshot is half volume", near(audioGain(open(500, 500), open(500 + EARSHOT / 2, 500), EARSHOT), 0.5));
check("beyond earshot is silent", audioGain(open(500, 500), open(500 + EARSHOT + 1, 500), EARSHOT) === 0);

// Sliding: pushing diagonally into a vertical wall should preserve vertical
// motion. Probed at y 600, which is bare west wall — y 500 used to be, until
// Karim's office put its south wall through it, and a probe that starts inside
// a wall tests nothing.
const slid = resolveMove({ x: 40, y: 600 }, { x: 10, y: 640 }, PLAYER_RADIUS, floor.walls, floor);
check("sliding along a wall preserves the free axis", slid.y > 600, `y moved to ${slid.y.toFixed(1)}`);
check("sliding along a wall blocks the blocked axis", slid.x >= 34, `x held at ${slid.x.toFixed(1)}`);

/* ── Broadcast and doors ─────────────────────────────────────────── */

console.log("\nBroadcast and doors\n");

const shouting = { x: 2180, y: 300, zoneId: "meeting", broadcasting: true };
check("a broadcast pierces a sealed room", audioGain(open(300, 870), shouting, EARSHOT) === 1);
check("a broadcast pierces distance", audioGain(open(60, 1600), shouting, EARSHOT) === 1);
check(
  "broadcast is one-way",
  audioGain(shouting, open(300, 870), EARSHOT) === 0,
  "the broadcaster still only hears their own room",
);

// Video follows the zone, not the distance — a face across the floor is still
// presence, but a sealed room is still private.
check("video carries across the open floor", videoVisible(open(60, 60), open(1600, 1400)));
check("video is hidden by a sealed room", !videoVisible(open(300, 870), inRoom("meeting")));
check("video is shared inside a room", videoVisible(inRoom("meeting"), inRoom("meeting")));
check("video is hidden between two rooms", !videoVisible(inRoom("annex"), inRoom("meeting")));
check("a broadcaster is visible from anywhere", videoVisible(inRoom("annex"), shouting));

const doorId = meetingDoor.id;
const d0 = meetingDoor;
// The meeting door hangs in a vertical wall, so it is approached from the west
// and passed through heading east. Both probes are offset from the door itself.
const approach = { x: d0.x - 90, y: d0.y + d0.h / 2 };
const beyond = { x: d0.x + d0.w + 170, y: d0.y + d0.h / 2 };
const openGeometry = collisionRects(floor, []);
check("an open door is not collision geometry", !openGeometry.some((r) => r === d0));
check(
  "a shut door becomes collision geometry",
  collisionRects(floor, [doorId]).length === openGeometry.length + 1,
);
check(
  "solid furniture is collision geometry",
  openGeometry.length > floor.walls.length,
  `${openGeometry.length - floor.walls.length} solid pieces`,
);

check("doorAt finds a door under the pointer", doorAt(d0.x + 5, d0.y + 40, floor.doors)?.id === doorId);
check("doorAt returns null away from any door", doorAt(300, 870, floor.doors) === null);

// A shut door must actually stop someone walking through the gap.
const shutWalls = collisionRects(floor, [doorId]);
const blocked = resolveMove(approach, beyond, PLAYER_RADIUS, shutWalls, floor);
check("a shut door blocks passage", blocked.x < d0.x - PLAYER_RADIUS + 1, `stopped at x = ${blocked.x.toFixed(1)}`);

const throughOpen = resolveMove(approach, beyond, PLAYER_RADIUS, openGeometry, floor);
check("an open door allows passage", throughOpen.x > d0.x + d0.w, `reached x = ${throughOpen.x.toFixed(1)}`);

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
const latestDoors = (c: Client) => [...c.inbox].reverse().find((m) => m.t === "doors");
const playerIn = (c: Client, id: string) => {
  const s = latestState(c);
  return s?.t === "state" ? s.players.find((p) => p.id === id) : undefined;
};

/**
 * Walk a client through waypoints in server-legal steps.
 *
 * The server caps travel per update, so a straight jump would be rejected as a
 * teleport — reaching a room means actually walking there.
 */
async function walkTo(c: Client, from: { x: number; y: number }, waypoints: { x: number; y: number }[]) {
  let pos = { ...from };
  for (const target of waypoints) {
    while (Math.hypot(target.x - pos.x, target.y - pos.y) > 4) {
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.min(55, dist);
      pos = { x: pos.x + (dx / dist) * step, y: pos.y + (dy / dist) * step };
      move(c, pos.x, pos.y);
      await wait(110);
    }
  }
  await wait(200);
  return pos;
}

async function run(): Promise<void> {
  console.log("\nServer\n");

  const alice = await connect("Alice");
  check("client receives welcome with an id", alice.id.length > 0, alice.id);

  const welcome = alice.inbox.find((m) => m.t === "welcome");
  // Against the floor this test compiled with, not a hard-coded count — the
  // point is that the server hands out the same plan the client is holding, and
  // adding a room should not fail a test about the welcome message.
  check(
    "welcome carries the floor",
    welcome?.t === "welcome" && welcome.floor.zones.length === floor.zones.length,
    `${welcome?.t === "welcome" ? welcome.floor.zones.length : "?"} zones`,
  );

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

  // Camera and screen publication is an on/off flag; which transceiver carries
  // which is fixed at connection time, so no ids are exchanged.
  bob.socket.send(JSON.stringify({ t: "media", cameraOn: true, screenOn: true }));
  await wait(250);
  const withMedia = latestState(alice);
  const bobMedia = withMedia?.t === "state" ? withMedia.players.find((p) => p.id === bob.id) : undefined;
  check("camera publication propagates", bobMedia?.cameraOn === true);
  check("screen publication propagates", bobMedia?.screenOn === true);

  bob.socket.send(JSON.stringify({ t: "media", cameraOn: false, screenOn: false }));
  await wait(250);
  const cleared = latestState(alice);
  const bobCleared = cleared?.t === "state" ? cleared.players.find((p) => p.id === bob.id) : undefined;
  check(
    "stopping publication clears both flags",
    bobCleared?.cameraOn === false && bobCleared?.screenOn === false,
  );

  // Junk must coerce to false rather than leaking into state.
  bob.socket.send(JSON.stringify({ t: "media", cameraOn: "yes", screenOn: null }));
  await wait(250);
  const junk = latestState(alice);
  const bobJunk = junk?.t === "state" ? junk.players.find((p) => p.id === bob.id) : undefined;
  check(
    "malformed media flags coerce to booleans",
    typeof bobJunk?.cameraOn === "boolean" && bobJunk?.screenOn === false,
  );

  // The server relays signalling verbatim and never joins the call.
  bob.inbox.length = 0;
  const offer = { kind: "description", type: "offer", sdp: "v=0\r\ns=smoke\r\n" };
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
    relayed?.t === "signal" &&
      relayed.data.kind === "description" &&
      relayed.data.type === "offer" &&
      relayed.data.sdp === offer.sdp,
  );

  // A signal aimed at nobody must not crash the server or leak to others.
  bob.inbox.length = 0;
  alice.socket.send(JSON.stringify({ t: "signal", to: "p999", data: offer }));
  await wait(200);
  check("signal to an unknown peer is dropped", !bob.inbox.some((m) => m.t === "signal"));
  check("server still alive after a bad signal", !!latestState(alice));

  /* ── Doors: authority and the empty-room release ───────────────── */

  console.log("\nDoors\n");

  // Walk Alice into the meeting room: right along the floor, up to the
  // doorway, then through it. Start from where the server actually thinks she
  // is — the rejected teleport left her partway across the floor.
  const before = playerIn(alice, alice.id);
  const arrived = await walkTo(
    alice,
    { x: before?.x ?? floor.spawn.x, y: before?.y ?? floor.spawn.y },
    // West of the desk banks, north up the open floor between Karim's office
    // and the meeting room, then east through the doorway.
    [
      { x: 620, y: 920 },
      { x: 620, y: meetingDoor.y + meetingDoor.h / 2 },
      { x: meetingDoor.x + 160, y: meetingDoor.y + meetingDoor.h / 2 },
    ],
  );
  const aliceInside = playerIn(alice, alice.id);
  check(
    "walking through the doorway puts you in the room",
    aliceInside?.zoneId === "meeting",
    `at (${arrived.x.toFixed(0)}, ${arrived.y.toFixed(0)}), zone = ${aliceInside?.zoneId ?? "null"}`,
  );

  alice.inbox.length = 0;
  bob.inbox.length = 0;
  alice.socket.send(JSON.stringify({ t: "door", id: "meeting-door", open: false }));
  await wait(300);

  const shutMsg = latestDoors(bob);
  check(
    "someone inside can shut the door",
    shutMsg?.t === "doors" && shutMsg.shut.includes("meeting-door"),
  );

  // Bob is outside. He must not be able to open it.
  bob.inbox.length = 0;
  bob.socket.send(JSON.stringify({ t: "door", id: "meeting-door", open: true }));
  await wait(300);
  check(
    "someone outside cannot open the door",
    !bob.inbox.some((m) => m.t === "doors" && !m.shut.includes("meeting-door")),
  );

  // Knocking is the sanctioned way in, and reaches only the room.
  alice.inbox.length = 0;
  bob.inbox.length = 0;
  bob.socket.send(JSON.stringify({ t: "knock", doorId: "meeting-door" }));
  await wait(300);

  const knock = alice.inbox.find((m) => m.t === "knock");
  check("a knock reaches the people inside", !!knock);
  check(
    "the knock names who is asking",
    knock?.t === "knock" && knock.name === "Bob",
    `name = ${knock?.t === "knock" ? knock.name : "none"}`,
  );
  check("the knocker does not hear their own knock", !bob.inbox.some((m) => m.t === "knock"));

  // The deadlock guard: a shut room with nobody in it must release itself,
  // because only people inside can work the door.
  bob.inbox.length = 0;
  alice.socket.close();
  await wait(600);

  const released = latestDoors(bob);
  check(
    "an empty room reopens its own door",
    released?.t === "doors" && !released.shut.includes("meeting-door"),
    "otherwise the room would be sealed forever",
  );

  // Alice has now gone, so check the departure here rather than at the end.
  check(
    "departure is broadcast",
    bob.inbox.some((m) => m.t === "left" && m.id === alice.id),
  );

  /* ── Chat ──────────────────────────────────────────────────────── */

  console.log("\nChat\n");

  // Fresh clients: Alice was disconnected above to prove the room release.
  const ann = await connect("Ann");
  const ben = await connect("Ben");
  const eve = await connect("Eve");
  await wait(250);

  const dm = dmChannel(toIdentity("Ann"), toIdentity("Ben"));
  const stamp = `smoke-${Date.now()}`;

  for (const c of [ann, ben, eve]) c.inbox.length = 0;
  ann.socket.send(JSON.stringify({ t: "chat", channel: TEAM_CHANNEL, body: `team ${stamp}` }));
  await wait(300);

  const teamMsg = (c: Client) =>
    c.inbox.find((m) => m.t === "chat" && m.message.body === `team ${stamp}`);
  check("team messages reach the sender", !!teamMsg(ann));
  check("team messages reach everyone else", !!teamMsg(ben) && !!teamMsg(eve));

  for (const c of [ann, ben, eve]) c.inbox.length = 0;
  ann.socket.send(JSON.stringify({ t: "chat", channel: dm, body: `dm ${stamp}` }));
  await wait(300);

  const dmMsg = (c: Client) => c.inbox.find((m) => m.t === "chat" && m.message.body === `dm ${stamp}`);
  check("a DM reaches both participants", !!dmMsg(ann) && !!dmMsg(ben));
  check("a DM reaches nobody else", !dmMsg(eve), "Eve is not in the thread");

  // Eve must not be able to post into someone else's thread either.
  for (const c of [ann, ben]) c.inbox.length = 0;
  eve.socket.send(JSON.stringify({ t: "chat", channel: dm, body: `intrusion ${stamp}` }));
  await wait(300);
  check(
    "an outsider cannot post into a DM",
    !ann.inbox.some((m) => m.t === "chat" && m.message.body.startsWith("intrusion")),
  );

  // Nor read it.
  eve.inbox.length = 0;
  eve.socket.send(JSON.stringify({ t: "history", channel: dm }));
  await wait(300);
  check("an outsider cannot read a DM", !eve.inbox.some((m) => m.t === "history"));

  // Empty and whitespace-only messages are not messages.
  ben.inbox.length = 0;
  ann.socket.send(JSON.stringify({ t: "chat", channel: TEAM_CHANNEL, body: "   " }));
  await wait(250);
  check("blank messages are dropped", !ben.inbox.some((m) => m.t === "chat"));

  // History is persisted, not just relayed.
  ben.inbox.length = 0;
  ben.socket.send(JSON.stringify({ t: "history", channel: TEAM_CHANNEL }));
  await wait(300);
  const history = ben.inbox.find((m) => m.t === "history");
  check("history comes back for a channel", !!history);
  check(
    "history contains the message we just sent",
    history?.t === "history" && history.messages.some((m) => m.body === `team ${stamp}`),
  );
  check(
    "history is oldest-first",
    history?.t === "history" &&
      history.messages.every((m, i, all) => i === 0 || all[i - 1].id < m.id),
  );

  /* ── Status ────────────────────────────────────────────────────── */

  ben.socket.send(JSON.stringify({ t: "status", status: "focusing", note: "  heads down  " }));
  await wait(300);
  const benStatus = playerIn(ann, ben.id);
  check("status propagates", benStatus?.status === "focusing");
  check("the note is trimmed", benStatus?.note === "heads down", `note = ${benStatus?.note}`);

  ben.socket.send(JSON.stringify({ t: "status", status: "nonsense", note: "" }));
  await wait(300);
  check("an unknown status is ignored", playerIn(ann, ben.id)?.status === "focusing");

  check(
    "identity is derived from the name",
    playerIn(ann, ben.id)?.identity === "ben",
    `identity = ${playerIn(ann, ben.id)?.identity}`,
  );

  eve.socket.close();
  await wait(200);

  /* ── Teardown ──────────────────────────────────────────────────── */

  console.log("\nTeardown\n");

  // Alice already disconnected above, which is what released the room.
  check(
    "departure is broadcast",
    bob.inbox.some((m) => m.t === "left" && m.id === alice.id),
  );

  bob.socket.close();
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
