# WovenTex Office

A spatial virtual office for the WovenTex team — a 2D floor you walk around, where
you hear the people near you and nobody else.

Built for **2–5 people, single tenant**. That constraint is the design: no
multi-tenancy, no billing, no seat limits, and at five concurrent users every
client subscribes to every peer, which removes the hardest engineering in
products like Kumospace.

## Status

**Phase 4 complete** — rooms you can shut yourself into, and a way to address
the whole floor.

| Phase | | |
|---|---|---|
| 1 | World, movement, presence | ✅ done |
| 2 | Proximity audio | ✅ done |
| 3 | Video circles + screenshare | ✅ done |
| 4 | Doors, broadcast | ✅ done |
| 5 | Chat, status | ← next |
| 6 | Art pass | |
| 7 | Auth, deploy, harden | |

### The gate

Phase 2 was the go/no-go point. Get four people in and do an hour of real work.
If they linger, build the rest; if they leave after ten minutes, you have
learned that for two weeks of effort rather than two months.

## Running it

```bash
npm install
npm run dev          # server on :3001, web on :3000
```

Open <http://localhost:3000> in two windows, enter different names, and both
avatars should move in sync. `WASD` or arrows to walk, click to walk somewhere,
scroll to zoom.

Individually:

```bash
npm run dev:server
npm run dev:web
```

## Checks

```bash
npm run typecheck      # all three packages
npm run verify:floor   # flood-fills the floor, proves every room is reachable
npm run smoke          # geometry rules + live server contract (server must be running)
```

Run `verify:floor` after editing the floor. It catches the two mistakes that are
invisible in source and obvious in play: a door gap too narrow to walk through,
and a zone edge overlapping a wall.

## Layout

```
shared/    types, collision + audio maths, the floor definition
server/    authoritative world state over ws
web/       Next.js app, PixiJS renderer
tools/     floor verifier, smoke test
```

`shared/` is imported as raw TypeScript by both sides — no build step. Its
internal imports are deliberately extensionless so that tsx (server) and
Turbopack (web) both resolve them.

### The floor is a source file

`shared/src/floor.ts` defines walls, rooms and spawn in world pixels. A
five-person team rearranges its office about twice a year, so the office is a
diff rather than a drag-and-drop editor — that decision alone saves several
weeks.

### Movement and trust

Clients simulate their own movement locally so it feels instant, then report
position at 15Hz. The server **validates rather than simulates**: it rejects
moves that clip walls, leave the world, or exceed walking speed, and corrects
the client when it does. Responsive to play, but you cannot teleport into a
closed meeting room.

Client and server share one copy of `resolveMove` in `shared/src/geometry.ts`.
If those two ever disagree, players rubber-band — so there is only one copy.

### The audio rule

`audioGain()` in `shared/src/geometry.ts` is the whole model. Precedence, and
the order matters:

1. **Broadcast** → full volume, through walls, shut doors and distance alike
2. **Same room** → full volume, distance irrelevant
3. **Either party in a room the other isn't** → silent, both ways
4. **Both on the open floor** → linear falloff to zero at `EARSHOT` (300px)

**It is not symmetric.** Everyone hears a broadcaster; the broadcaster still
hears only the room around them. Anything deciding whether to *send* media must
evaluate the reverse direction rather than reusing the result — which is exactly
what `onGain` and `onSendVideo` are, two calls instead of one.

### Doors

An open door is a gap in the wall; a shut one is wall, derived identically on
both sides by `wallsWithShutDoors`. Doors do not affect audio at all — the zone
already seals it. What a door adds is control over *entry*: you cannot walk into
a shut room, only knock.

Doors can only be worked from inside, so a room whose last occupant left while
it was shut would be sealed permanently. The server reopens empty rooms every
tick to remove that dead end.

### Movement is swept, not sampled

`resolveMove` advances in substeps of at most 8px — below the thinnest wall
(14px) — and each substep advances from the body's **actual** position, never
along the original ray. Stepping along the ray lets a blocked body leapfrog: it
gets stuck at a wall, but a later ray point on the far side is free, and the
endpoint check jumps straight to it. Frame-to-frame movement is ~4px so this
never shows in play, but the server accepts bursts of a few hundred pixels after
network jitter — which a modified client could aim at a shut door.

## Voice

### Mesh peer-to-peer, not an SFU

Faces render in a ~44px circle, so capture is 320×320 at 24fps capped at
250kbps — not the ~600 a naive 720p stream costs, which the scaler would just
throw away. Four outbound faces is ~1Mbps up, which a five-person office can
afford.

**The real SFU trigger** is several people watching one screenshare at once,
which fans out at ~1.5Mbps per copy. If that becomes routine, move to
self-hosted LiveKit.

### Video follows the zone, audio follows the distance

`videoVisible()` is deliberately **not** distance-based. Faces carry presence:
you want to see who is around from across the floor, and a camera that only
appears once you are already close is indistinguishable from a broken one. Only
a sealed room hides video — that is the privacy boundary that actually matters.

Audio still falls off with distance. The two rules are different on purpose.

STUN alone covers the same LAN and most home NATs. Production needs TURN for the
~10–20% of connections behind symmetric NAT — that lands in Phase 7.

### Transceivers, not addTrack

Three transceivers are created per peer at connection time in a fixed order —
audio, camera, screen — identically on both sides, so the m-lines line up. Two
things fall out of that:

- **Routing needs no signalling.** A track's position identifies it as a face or
  a screen. Matching on MediaStream id instead is fragile, because
  `replaceTrack` does not renegotiate and the receiver may never learn the msid.
- **Toggling a camera never renegotiates.** `replaceTrack` on an existing
  transceiver does not change the session.

Perfect negotiation still guards the initial handshake, where both sides may
offer at once — one side of each pair is "polite" and yields on collision.

### React double-invokes effects in development

Anything reached from an `await` inside the setup effect must check whether it
was cancelled, and `OfficeClient.connect()` refuses to reconnect once disposed.
Without both, the first, already-cleaned-up client opens a socket anyway from an
async continuation, and every tab shows up in the office twice.

### Video is DOM, not canvas

Faces are real `<video>` elements positioned over the Pixi canvas with a
transform. Drawing video into WebGL costs a texture upload per frame per peer,
and the browser already composites video on the GPU for free. `OfficeScene`
projects avatars into screen space each frame and hands positions to
`VideoOverlay`, which writes to the DOM directly — React state at 60fps would be
absurd.

Every video element is `muted`. Voice arrives on a separate `<audio>` element
with proximity volume applied; an unmuted video element would play it a second
time at full volume, defeating the whole model.

### The echo trap, and why there isn't one

The usual failure in this product category is routing WebRTC audio through a Web
Audio graph to get a `GainNode`. Chrome's echo cancellation lives on the
media-element path, so doing that silently switches AEC off: perfect in
headphones, howling on laptop speakers. The common fix — looping the processed
stream back through a local `RTCPeerConnection` — works, but costs real
complexity and kills stereo panning.

We need exactly one thing from the graph, a volume control, and
`HTMLMediaElement.volume` already is one, on the native path where AEC works. So
there is no graph and no trap to work around. Web Audio is still used for
voice-activity detection, but only as an `AnalyserNode` that is never connected
to a destination — nothing is played through it.

If a compressor is ever needed for group calls, that is the point to reach for
the loopback, and the point to re-read this section.

### Volume is never assigned directly

Walking changes distance continuously, and stepping the value each frame is
audible as a click. Gain is smoothed exponentially toward its target
(`GAIN_SMOOTHING`), and new peers fade up from silence rather than popping in.
