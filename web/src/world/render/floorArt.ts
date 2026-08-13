/**
 * Ground materials.
 *
 * Everything is drawn procedurally rather than loaded as textures — no assets to
 * ship, and the whole floor is one Graphics per material. If a real illustrator
 * ever delivers a rendered floorplan, this is the layer it replaces: swap the
 * body of drawMaterial for a Sprite and nothing above it changes.
 */

import { Graphics } from "pixi.js";
import type { Material, Rect } from "@wtoffice/shared";
import { PALETTE } from "./palette";

/** Plank seams, staggered row to row so it does not read as a grid. */
function planks(g: Graphics, r: Rect, line: string, rowHeight: number, plankLength: number): void {
  const right = r.x + r.w;
  const bottom = r.y + r.h;

  for (let y = r.y + rowHeight; y < bottom; y += rowHeight) {
    g.moveTo(r.x, y).lineTo(right, y);
  }
  g.stroke({ width: 1, color: line, alpha: 0.5 });

  let row = 0;
  for (let y = r.y; y < bottom; y += rowHeight) {
    const stagger = (row % 2) * (plankLength / 2);
    for (let x = r.x + stagger; x < right; x += plankLength) {
      if (x <= r.x) continue;
      g.moveTo(x, y).lineTo(x, Math.min(y + rowHeight, bottom));
    }
    row++;
  }
  g.stroke({ width: 1, color: line, alpha: 0.32 });
}

function grid(g: Graphics, r: Rect, line: string, size: number): void {
  const right = r.x + r.w;
  const bottom = r.y + r.h;
  for (let x = r.x + size; x < right; x += size) g.moveTo(x, r.y).lineTo(x, bottom);
  for (let y = r.y + size; y < bottom; y += size) g.moveTo(r.x, y).lineTo(right, y);
  g.stroke({ width: 1, color: line, alpha: 0.55 });
}

/** Tight horizontal lines, which at this scale read as pile rather than stripes. */
function pile(g: Graphics, r: Rect, line: string): void {
  const bottom = r.y + r.h;
  for (let y = r.y + 4; y < bottom; y += 7) {
    g.moveTo(r.x, y).lineTo(r.x + r.w, y);
  }
  g.stroke({ width: 1, color: line, alpha: 0.28 });
}

export function drawMaterial(g: Graphics, r: Rect, material: Material, radius = 0): void {
  const base = {
    oak: PALETTE.oak,
    tile: PALETTE.tile,
    carpet: PALETTE.carpet,
    concrete: PALETTE.shell,
  }[material];

  if (radius > 0) g.roundRect(r.x, r.y, r.w, r.h, radius).fill(base);
  else g.rect(r.x, r.y, r.w, r.h).fill(base);

  switch (material) {
    case "oak":
      planks(g, r, PALETTE.oakLine, 46, 190);
      break;
    case "tile":
      grid(g, r, PALETTE.tileLine, 62);
      break;
    case "carpet":
      pile(g, r, PALETTE.carpetLine);
      break;
    case "concrete":
      break;
  }
}

/** The floor inside a sealed room — lighter, so rooms read as separate spaces. */
export function drawRoomFloor(g: Graphics, r: Rect): void {
  g.rect(r.x, r.y, r.w, r.h).fill(PALETTE.roomFloor);
  planks(g, r, PALETTE.roomFloorLine, 44, 180);
}

/**
 * Walls, with a lit top edge and a shadow cast down onto the floor.
 *
 * The shadow is what gives the plan any sense of height at all; without it
 * walls read as tape on the ground.
 */
export function drawWalls(shadowLayer: Graphics, wallLayer: Graphics, walls: Rect[]): void {
  for (const w of walls) {
    shadowLayer.rect(w.x + 3, w.y + 5, w.w, w.h).fill({ color: PALETTE.shadow, alpha: 0.16 });
  }
  for (const w of walls) {
    wallLayer.rect(w.x, w.y, w.w, w.h).fill(PALETTE.wall);
  }
  // Catch light along the top of each run.
  for (const w of walls) {
    wallLayer.rect(w.x, w.y, w.w, Math.min(3, w.h)).fill({ color: PALETTE.wallTop, alpha: 0.9 });
  }
}
