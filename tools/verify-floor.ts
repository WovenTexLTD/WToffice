/**
 * Flood-fill the floor from spawn to prove every zone is reachable.
 *
 * Run after editing shared/src/floor.ts — it catches the two mistakes that are
 * invisible in source and obvious in play: a door gap too narrow to walk
 * through, and a zone whose edge overlaps a wall.
 *
 *   npm run verify:floor
 */
import { woventexFloor as f, hitsAnyWall, pointInRect, PLAYER_RADIUS } from "../shared/src/index";

const STEP = 10;
const cols = Math.ceil(f.width / STEP);
const rows = Math.ceil(f.height / STEP);

const walkable = (x: number, y: number) =>
  x >= PLAYER_RADIUS && y >= PLAYER_RADIUS &&
  x <= f.width - PLAYER_RADIUS && y <= f.height - PLAYER_RADIUS &&
  !hitsAnyWall(x, y, PLAYER_RADIUS, f.walls);

if (!walkable(f.spawn.x, f.spawn.y)) {
  console.error("FAIL: spawn point is inside a wall");
  process.exit(1);
}

const seen = new Uint8Array(cols * rows);
const idx = (c: number, r: number) => r * cols + c;
const start: [number, number] = [Math.round(f.spawn.x / STEP), Math.round(f.spawn.y / STEP)];
const queue: [number, number][] = [start];
seen[idx(...start)] = 1;
let reached = 0;

while (queue.length) {
  const [c, r] = queue.pop()!;
  reached++;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nc = c + dc, nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
    if (seen[idx(nc, nr)]) continue;
    if (!walkable(nc * STEP, nr * STEP)) continue;
    seen[idx(nc, nr)] = 1;
    queue.push([nc, nr]);
  }
}

let ok = true;
for (const z of f.zones) {
  let inside = 0;
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (seen[idx(c, r)] && pointInRect(c * STEP, r * STEP, z)) inside++;
  const verdict = inside > 20 ? "reachable" : "UNREACHABLE";
  if (inside <= 20) ok = false;
  console.log(`  zone "${z.id}": ${inside} reachable cells — ${verdict}`);
}

// Zones must not overlap walls, or players get stuck at the threshold.
for (const z of f.zones) {
  for (const w of f.walls) {
    const overlap =
      z.x < w.x + w.w && z.x + z.w > w.x && z.y < w.y + w.h && z.y + z.h > w.y;
    if (overlap) {
      console.error(`  FAIL: zone "${z.id}" overlaps a wall at ${JSON.stringify(w)}`);
      ok = false;
    }
  }
}

console.log(`\n  spawn walkable: yes`);
console.log(`  reachable area: ${reached} / ${cols * rows} cells (${((reached / (cols * rows)) * 100).toFixed(1)}%)`);
console.log(ok ? "\nFLOOR OK\n" : "\nFLOOR BROKEN\n");
process.exit(ok ? 0 : 1);
