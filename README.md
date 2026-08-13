# WovenTex Office

A spatial virtual office for the WovenTex team — a 2D floor you walk around, where
you hear the people near you and nobody else.

Built for **2–5 people, single tenant**. That constraint is the design: no
multi-tenancy, no billing, no seat limits, and at five concurrent users every
client subscribes to every peer, which removes the hardest engineering in
products like Kumospace.

## Status

**Phase 2 complete** — you can walk up to someone and talk to them.

| Phase | | |
|---|---|---|
| 1 | World, movement, presence | ✅ done |
| 2 | Proximity audio | ✅ done |
| 3 | Video circles + screenshare | ← next |
| 4 | Doors, broadcast | |
| 5 | Chat, status | |
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

`audioGain()` in `shared/src/geometry.ts` is already the real rule; Phase 2 just
connects it to a `GainNode`. Order matters — zone membership is checked before
distance, because a sealed room overrides proximity in both directions:

- same room → full volume, distance irrelevant
- either party in a room the other isn't → silent, both ways
- both on the open floor → linear falloff to zero at `EARSHOT` (300px)

## Voice

### Mesh peer-to-peer, not an SFU

At five people, audio-only, mesh is correct. Opus is ~32kbps, so four outbound
streams is ~128kbps. In exchange: lowest possible latency, no media server, no
account, no API key — the world socket is already a fine signalling channel, and
it relays signalling verbatim without ever joining the call.

**Revisit at Phase 3.** Video is ~600kbps per stream, so four outbound becomes
~2.4Mbps up and weak uplinks suffer. That is where an SFU (self-hosted LiveKit)
starts paying for itself. Not here.

STUN alone covers the same LAN and most home NATs. Production needs TURN for the
~10–20% of connections behind symmetric NAT — that lands in Phase 7.

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
