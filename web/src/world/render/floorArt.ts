/**
 * Ground materials.
 *
 * Everything is drawn procedurally rather than loaded as textures — no assets to
 * ship, and the whole floor is one Graphics per material. If a real illustrator
 * ever delivers a rendered floorplan, this is the layer it replaces: swap the
 * body of drawMaterial for a Sprite and nothing above it changes.
 */

import { Graphics } from "pixi.js";
import { WALL_HEIGHT, type Material, type Rect, type Sign } from "@wtoffice/shared";
import { PALETTE } from "./palette";

/**
 * Deterministic value noise from a coordinate pair.
 *
 * Deliberately not Math.random: the floor must look identical on every load and
 * for every person, or two people describing the same room would disagree.
 */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Staggered planks, each shaded slightly differently.
 *
 * The per-plank tone variation is what separates "wood floor" from "lines on a
 * beige rectangle" — real boards never match.
 */
function planks(g: Graphics, r: Rect, line: string, rowHeight: number, plankLength: number): void {
  const right = r.x + r.w;
  const bottom = r.y + r.h;

  let row = 0;
  for (let y = r.y; y < bottom; y += rowHeight) {
    const stagger = (row % 2) * (plankLength / 2);
    const rowBottom = Math.min(y + rowHeight, bottom);

    for (let x = r.x - stagger; x < right; x += plankLength) {
      const left = Math.max(x, r.x);
      const width = Math.min(x + plankLength, right) - left;
      if (width <= 0) continue;

      // ±4% lightness, deterministic per board.
      const shade = hash(left, y);
      g.rect(left, y, width, rowBottom - y).fill({
        color: shade > 0.5 ? "#FFFFFF" : "#000000",
        alpha: 0.012 + (Math.abs(shade - 0.5) * 0.05),
      });
    }
    row++;
  }

  for (let y = r.y + rowHeight; y < bottom; y += rowHeight) {
    g.moveTo(r.x, y).lineTo(right, y);
  }
  g.stroke({ width: 1, color: line, alpha: 0.5 });

  row = 0;
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

/** Tiles, each very slightly off from its neighbours. */
function grid(g: Graphics, r: Rect, line: string, size: number): void {
  const right = r.x + r.w;
  const bottom = r.y + r.h;

  for (let y = r.y; y < bottom; y += size) {
    for (let x = r.x; x < right; x += size) {
      const w = Math.min(x + size, right) - x;
      const h = Math.min(y + size, bottom) - y;
      const shade = hash(x * 0.7, y * 1.3);
      g.rect(x, y, w, h).fill({
        color: shade > 0.5 ? "#FFFFFF" : "#000000",
        alpha: 0.01 + Math.abs(shade - 0.5) * 0.04,
      });
    }
  }

  for (let x = r.x + size; x < right; x += size) g.moveTo(x, r.y).lineTo(x, bottom);
  for (let y = r.y + size; y < bottom; y += size) g.moveTo(r.x, y).lineTo(right, y);
  g.stroke({ width: 1, color: line, alpha: 0.55 });
}

/**
 * Carpet: a woven cross-hatch rather than stripes.
 *
 * On brand, and at this scale the two directions read as pile rather than as a
 * grid — a single direction looks like corduroy.
 */
function pile(g: Graphics, r: Rect, line: string): void {
  const right = r.x + r.w;
  const bottom = r.y + r.h;

  for (let y = r.y + 4; y < bottom; y += 7) g.moveTo(r.x, y).lineTo(right, y);
  g.stroke({ width: 1, color: line, alpha: 0.26 });

  for (let x = r.x + 4; x < right; x += 7) g.moveTo(x, r.y).lineTo(x, bottom);
  g.stroke({ width: 1, color: line, alpha: 0.14 });
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
 * Ambient occlusion: a soft dark halo where walls meet the floor.
 *
 * Three expanded rectangles at rising opacity, drawn under everything. Cheap,
 * and it does more for the sense of a lit room than any amount of texture.
 */
export function drawOcclusion(g: Graphics, walls: Rect[]): void {
  const bands: [number, number][] = [
    [14, 0.03],
    [8, 0.035],
    [3, 0.045],
  ];
  for (const [spread, alpha] of bands) {
    for (const w of walls) {
      g.roundRect(w.x - spread, w.y - spread, w.w + spread * 2, w.h + spread * 2 + WALL_HEIGHT, spread)
        .fill({ color: PALETTE.shadow, alpha });
    }
  }
}

/**
 * Walls as volumes rather than outlines.
 *
 * Each run gets a shaded face dropping WALL_HEIGHT toward the viewer, a lit top
 * surface, and a catch-light along its top edge. Drawn back-to-front by their
 * bottom edge, so a wall nearer the viewer correctly covers the face of one
 * behind it — painter's algorithm, and the reason this is one pass per wall
 * rather than one pass per surface.
 */
export function drawWalls(shadowLayer: Graphics, wallLayer: Graphics, walls: Rect[]): void {
  for (const w of walls) {
    shadowLayer
      .rect(w.x + 5, w.y + w.h + WALL_HEIGHT - 4, w.w, 12)
      .fill({ color: PALETTE.shadow, alpha: 0.14 });
  }

  const sorted = [...walls].sort((a, b) => a.y + a.h - (b.y + b.h));

  for (const w of sorted) {
    // Face.
    wallLayer.rect(w.x, w.y + w.h, w.w, WALL_HEIGHT).fill(PALETTE.wallFace);
    // A slight gradient down the face, darker at the foot.
    wallLayer
      .rect(w.x, w.y + w.h + WALL_HEIGHT * 0.55, w.w, WALL_HEIGHT * 0.45)
      .fill({ color: PALETTE.shadow, alpha: 0.22 });

    // Top surface.
    wallLayer.rect(w.x, w.y, w.w, w.h).fill(PALETTE.wallTop);
    // Catch-light.
    wallLayer.rect(w.x, w.y, w.w, 2).fill({ color: PALETTE.wallEdge, alpha: 0.85 });
  }
}

/**
 * The woven mark — interlaced warp and weft.
 *
 * Alternating cells carry a horizontal or vertical bar, which is what a plain
 * weave actually looks like from above, and reads as a logo at small sizes.
 */
export function drawWeaveMark(g: Graphics, cx: number, cy: number, size: number, color: string): void {
  const cells = 4;
  const cell = size / cells;
  const bar = cell * 0.52;
  const originX = cx - size / 2;
  const originY = cy - size / 2;

  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const x = originX + col * cell;
      const y = originY + row * cell;
      const over = (row + col) % 2 === 0;
      if (over) {
        g.rect(x, y + (cell - bar) / 2, cell, bar).fill({ color, alpha: 0.95 });
      } else {
        g.rect(x + (cell - bar) / 2, y, bar, cell).fill({ color, alpha: 0.6 });
      }
    }
  }
}

/** The panel behind a sign. Text is added by the caller, which owns fonts. */
export function drawSignPanel(g: Graphics, sign: Sign): void {
  g.roundRect(sign.x, sign.y, sign.w, sign.h, 3).fill(PALETTE.shadow);
  g.roundRect(sign.x, sign.y, sign.w, sign.h, 3).stroke({
    width: 1,
    color: PALETTE.brass,
    alpha: 0.55,
  });
  if (sign.mark) {
    const size = sign.h * 0.6;
    drawWeaveMark(g, sign.x + 4 + size / 2 + 6, sign.y + sign.h / 2, size, PALETTE.brass);
  }
}

/**
 * Glazed entrance doors, drawn over the wall.
 *
 * The wall behind stays solid — there is nowhere to go — but daylight coming
 * through is what makes the room feel like it has an outside.
 */
export function drawEntranceLight(g: Graphics, r: Rect): void {
  const spill = 74;
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    g.rect(r.x + r.w, r.y - 8 + t * 6, spill * (1 - t * 0.35), r.h + 16 - t * 12).fill({
      color: PALETTE.glassLight,
      alpha: 0.09 * (1 - t),
    });
  }
}

/** The doors themselves, drawn over the wall they are set into. */
export function drawEntrance(g: Graphics, r: Rect): void {
  g.rect(r.x, r.y, r.w, r.h).fill(PALETTE.frame);

  const inset = 2.5;
  const leafHeight = (r.h - inset * 3) / 2;
  for (let i = 0; i < 2; i++) {
    const y = r.y + inset + i * (leafHeight + inset);
    g.rect(r.x + inset, y, r.w - inset * 2, leafHeight).fill({
      color: PALETTE.glass,
      alpha: 0.92,
    });
    // A highlight streak, so it reads as glass rather than paint.
    g.rect(r.x + inset, y + leafHeight * 0.18, r.w - inset * 2, leafHeight * 0.22).fill({
      color: PALETTE.glassLight,
      alpha: 0.55,
    });
  }

  // Brass handles at the meeting stiles.
  for (const dy of [-9, 9]) {
    g.circle(r.x + r.w / 2, r.y + r.h / 2 + dy, 2.2).fill(PALETTE.brass);
  }
}
