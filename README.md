# WovenTex Office

A spatial virtual office for the WovenTex team — a 2D floor you walk around, where
you hear the people near you and nobody else.

Built for **2–5 people, single tenant**. That constraint is the design: no
multi-tenancy, no billing, no seat limits, and at five concurrent users every
client subscribes to every peer, which removes the hardest engineering in
products like Kumospace.

## Status

**Phase 1 complete** — the world, movement and multiplayer sync.
Proximity audio (Phase 2) is next, and is the thing that decides whether this
is worth finishing.

| Phase | | |
|---|---|---|
| 1 | World, movement, presence | ✅ done |
| 2 | Proximity audio | ← next |
| 3 | Video circles + screenshare | |
| 4 | Doors, broadcast | |
| 5 | Chat, status | |
| 6 | Art pass | |
| 7 | Auth, deploy, harden | |

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

## Known Phase 2 trap

Routing WebRTC audio through Web Audio silently disables Chrome's echo
cancellation, because AEC lives on the `<audio>` element path rather than the
graph. It will sound perfect in headphones and howl on laptop speakers. The fix
is looping the processed stream back through a local `RTCPeerConnection`, and
the cost is that stereo panning stops working. Take that trade — distance-based
volume only. Test on speakers from the first hour.
