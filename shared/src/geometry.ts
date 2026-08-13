/**
 * Collision and zone maths.
 *
 * Both the client (predicting its own movement) and the server (validating it)
 * import from here. If these two ever disagree the player rubber-bands, so
 * there is deliberately only one copy.
 */

import type { Door, Floor, Rect, Vec2, Zone } from "./types";

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** True if a circle overlaps an axis-aligned rectangle. */
export function circleHitsRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nearestX = clamp(cx, rect.x, rect.x + rect.w);
  const nearestY = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < r * r;
}

export function hitsAnyWall(x: number, y: number, r: number, walls: Rect[]): boolean {
  for (const w of walls) {
    if (circleHitsRect(x, y, r, w)) return true;
  }
  return false;
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * Furthest point along `from → to` that doesn't clip a wall.
 *
 * Without this, a blocked move falls back to the previous position, so you stop
 * a whole step short of the wall and can never close the gap — it reads as an
 * invisible barrier. Ten bisections resolve to well under a pixel.
 */
function furthestFree(from: Vec2, to: Vec2, radius: number, walls: Rect[]): Vec2 {
  if (!hitsAnyWall(to.x, to.y, radius, walls)) return to;

  let free = 0;
  let blocked = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (free + blocked) / 2;
    const x = from.x + (to.x - from.x) * mid;
    const y = from.y + (to.y - from.y) * mid;
    if (hitsAnyWall(x, y, radius, walls)) blocked = mid;
    else free = mid;
  }
  return { x: from.x + (to.x - from.x) * free, y: from.y + (to.y - from.y) * free };
}

/**
 * Longest movement resolved in one go, in world pixels.
 *
 * Must stay below the thinnest wall (14px, and doors are the same) or a single
 * long move tunnels straight through. Frame-to-frame movement is ~4px so this
 * never bites in normal play — but the server accepts a burst of up to a few
 * hundred pixels after network jitter, and a modified client could aim one
 * squarely at a shut door.
 */
const MAX_SUBSTEP = 8;

/**
 * One axis-separated collision step.
 *
 * Only safe when `to` is within MAX_SUBSTEP of `from` — the early return trusts
 * the endpoint, so a longer step could pass through a thin wall.
 */
function resolveStep(from: Vec2, to: Vec2, radius: number, walls: Rect[]): Vec2 {
  if (!hitsAnyWall(to.x, to.y, radius, walls)) return to;

  let pos: Vec2 = { x: from.x, y: from.y };
  pos = furthestFree(pos, { x: to.x, y: pos.y }, radius, walls);
  pos = furthestFree(pos, { x: pos.x, y: to.y }, radius, walls);
  return pos;
}

/**
 * Move from `from` toward `to`, sliding along walls rather than sticking to them.
 *
 * Axes are resolved one at a time. That separation is what lets you slide along
 * a wall instead of stopping dead when you push into it diagonally — the
 * difference between movement that feels good and movement that feels broken.
 * Each axis creeps as far as it legally can, so you end up flush to the wall.
 *
 * Long moves are swept in substeps rather than tested only at the endpoint,
 * which is what stops a single large step passing through a thin wall.
 */
export function resolveMove(
  from: Vec2,
  to: Vec2,
  radius: number,
  walls: Rect[],
  bounds: { width: number; height: number },
): Vec2 {
  const cx = clamp(to.x, radius, bounds.width - radius);
  const cy = clamp(to.y, radius, bounds.height - radius);

  const dx = cx - from.x;
  const dy = cy - from.y;
  const dist = Math.hypot(dx, dy);

  if (dist <= MAX_SUBSTEP) return resolveStep(from, { x: cx, y: cy }, radius, walls);

  // Advance from where the body actually is, never along the original ray.
  // Stepping along the ray lets a blocked body leapfrog: once it is stuck at a
  // wall, a later ray point on the far side is free, and the endpoint check
  // inside resolveStep would happily jump to it — straight through the wall.
  const ux = dx / dist;
  const uy = dy / dist;

  let pos: Vec2 = { x: from.x, y: from.y };
  let remaining = dist;

  while (remaining > 0.0001) {
    const step = Math.min(MAX_SUBSTEP, remaining);
    pos = resolveStep(pos, { x: pos.x + ux * step, y: pos.y + uy * step }, radius, walls);
    remaining -= step;
  }
  return pos;
}

/** Which sealed audio zone contains this point, if any. */
export function zoneAt(x: number, y: number, zones: Zone[]): string | null {
  for (const z of zones) {
    if (pointInRect(x, y, z)) return z.id;
  }
  return null;
}

export interface AudioActor {
  x: number;
  y: number;
  zoneId: string | null;
  broadcasting?: boolean;
}

/**
 * How loudly `listener` hears `speaker`, 0–1.
 *
 * Precedence, and the order matters:
 *  1. Broadcast wins over everything, in one direction only.
 *  2. Zone membership beats distance — a sealed room overrides proximity.
 *  3. Otherwise, linear falloff to zero at the earshot boundary.
 *
 * Note this is NOT symmetric once broadcast is involved: everyone hears the
 * broadcaster, but the broadcaster still hears only the room around them. Any
 * caller deciding whether to *send* media must evaluate the reverse direction
 * rather than reusing this result.
 */
export function audioGain(listener: AudioActor, speaker: AudioActor, earshot: number): number {
  // A broadcast pierces walls, shut doors and distance alike.
  if (speaker.broadcasting) return 1;

  // Same sealed room — full volume, distance irrelevant.
  if (listener.zoneId !== null && listener.zoneId === speaker.zoneId) return 1;

  // Either party is in a room the other isn't — sealed, silent both ways.
  if (listener.zoneId !== null || speaker.zoneId !== null) return 0;

  // Both on the open floor — linear falloff to zero at the earshot boundary.
  const d = Math.hypot(speaker.x - listener.x, speaker.y - listener.y);
  return clamp((earshot - d) / earshot, 0, 1);
}

/**
 * Collision geometry including any shut doors.
 *
 * An open door is a gap in the wall; a shut one is wall. Client and server must
 * derive this identically or a shut door would be passable on one side only.
 */
export function wallsWithShutDoors(floor: Floor, shutDoorIds: Iterable<string>): Rect[] {
  const shut = shutDoorIds instanceof Set ? shutDoorIds : new Set(shutDoorIds);
  if (shut.size === 0) return floor.walls;

  const extra = floor.doors.filter((d) => shut.has(d.id));
  return extra.length === 0 ? floor.walls : [...floor.walls, ...extra];
}

/** The door under a point, if any. Padded so small doors stay clickable. */
export function doorAt(x: number, y: number, doors: Door[], padding = 14): Door | null {
  for (const d of doors) {
    if (
      x >= d.x - padding &&
      x <= d.x + d.w + padding &&
      y >= d.y - padding &&
      y <= d.y + d.h + padding
    ) {
      return d;
    }
  }
  return null;
}
