/**
 * Furniture, drawn as vector shapes rather than sprites.
 *
 * Every piece is drawn centred on the origin so the caller can position and
 * rotate a container around its middle. No image assets, which means no loading,
 * no atlas and no licence — and it scales cleanly at any zoom.
 *
 * If a real illustrator delivers sprites later, this file is the seam: return a
 * Sprite from build() instead of a Graphics and nothing else changes.
 */

import { Container, Graphics } from "pixi.js";
import {
  FURNITURE_HEIGHT,
  FURNITURE_SIZE,
  type Furniture,
  type FurnitureKind,
} from "@wtoffice/shared";
import { PALETTE, SPINE_COLORS } from "./palette";

type Draw = (g: Graphics, w: number, h: number) => void;

const DRAW: Record<FurnitureKind, Draw> = {
  desk(g, w, h) {
    g.roundRect(-w / 2, -h / 2, w, h, 5).fill(PALETTE.walnut);
    g.roundRect(-w / 2, -h / 2, w, h, 5).stroke({ width: 1.5, color: PALETTE.walnutDark });
    // Grain, just enough to stop it reading as a flat slab.
    for (let i = 1; i < 4; i++) {
      const y = -h / 2 + (h / 4) * i;
      g.moveTo(-w / 2 + 6, y).lineTo(w / 2 - 6, y);
    }
    g.stroke({ width: 1, color: PALETTE.walnutLight, alpha: 0.35 });

    g.roundRect(-24, -h / 2 + 7, 48, 13, 2).fill(PALETTE.slate);
    g.roundRect(-22, 4, 44, 11, 2).fill({ color: PALETTE.oatmeal, alpha: 0.9 });
  },

  chair(g, w, h) {
    g.roundRect(-w / 2 + 3, -h / 2 + 7, w - 6, h - 10, 6).fill(PALETTE.oatmeal);
    g.roundRect(-w / 2 + 3, -h / 2 + 7, w - 6, h - 10, 6).stroke({
      width: 1.2,
      color: PALETTE.oatmealDark,
    });
    g.roundRect(-w / 2 + 1, -h / 2, w - 2, 8, 4).fill(PALETTE.oatmealDark);
  },

  sofa(g, w, h) {
    g.roundRect(-w / 2, -h / 2, w, h, 12).fill(PALETTE.oatmeal);
    g.roundRect(-w / 2, -h / 2, w, 20, 10).fill(PALETTE.oatmealDark);
    g.roundRect(-w / 2, -h / 2 + 6, 20, h - 6, 9).fill(PALETTE.oatmealDark);
    g.roundRect(w / 2 - 20, -h / 2 + 6, 20, h - 6, 9).fill(PALETTE.oatmealDark);
    // Cushion seams.
    for (const x of [-w / 6, w / 6]) {
      g.moveTo(x, -h / 2 + 22).lineTo(x, h / 2 - 4);
    }
    g.stroke({ width: 1.2, color: PALETTE.oatmealDark, alpha: 0.9 });
  },

  armchair(g, w, h) {
    g.roundRect(-w / 2, -h / 2, w, h, 11).fill(PALETTE.oatmeal);
    g.roundRect(-w / 2, -h / 2, w, 17, 9).fill(PALETTE.oatmealDark);
    g.roundRect(-w / 2, -h / 2 + 5, 13, h - 5, 8).fill(PALETTE.oatmealDark);
    g.roundRect(w / 2 - 13, -h / 2 + 5, 13, h - 5, 8).fill(PALETTE.oatmealDark);
  },

  meetingTable(g, w, h) {
    g.roundRect(-w / 2, -h / 2, w, h, 22).fill(PALETTE.walnut);
    g.roundRect(-w / 2, -h / 2, w, h, 22).stroke({ width: 2, color: PALETTE.walnutDark });
    g.roundRect(-w / 2 + 12, -h / 2 + 12, w - 24, h - 24, 14).stroke({
      width: 1,
      color: PALETTE.walnutLight,
      alpha: 0.5,
    });
  },

  coffeeTable(g, w, h) {
    g.roundRect(-w / 2, -h / 2, w, h, 8).fill(PALETTE.walnutLight);
    g.roundRect(-w / 2, -h / 2, w, h, 8).stroke({ width: 1.4, color: PALETTE.walnutDark });
  },

  stool(g, w) {
    g.circle(0, 0, w / 2).fill(PALETTE.oatmeal);
    g.circle(0, 0, w / 2).stroke({ width: 1.4, color: PALETTE.oatmealDark });
    g.circle(0, 0, w / 2 - 5).stroke({ width: 1, color: PALETTE.oatmealDark, alpha: 0.6 });
  },

  counter(g, w, h) {
    g.roundRect(-w / 2, -h / 2, w, h, 5).fill(PALETTE.stone);
    g.roundRect(-w / 2, -h / 2, w, h, 5).stroke({ width: 1.5, color: PALETTE.oatmealDark });
    // Sink and tap.
    g.roundRect(-w / 2 + 32, -h / 2 + 12, 52, h - 24, 4).fill({
      color: PALETTE.slate,
      alpha: 0.35,
    });
    g.circle(-w / 2 + 58, -h / 2 + 8, 3.5).fill(PALETTE.brass);
    // Hob.
    for (const dx of [-18, 18]) {
      for (const dy of [-9, 9]) g.circle(w / 4 + dx, dy, 7).fill({ color: PALETTE.slate, alpha: 0.4 });
    }
  },

  plant(g, w) {
    const r = w / 2;
    g.roundRect(-r * 0.55, r * 0.1, r * 1.1, r * 0.85, 4).fill(PALETTE.terracotta);
    // Foliage: a few overlapping blobs read as leaves from above.
    const leaves: [number, number, number, string][] = [
      [-r * 0.42, -r * 0.28, r * 0.5, PALETTE.leafDark],
      [r * 0.38, -r * 0.2, r * 0.46, PALETTE.leafDark],
      [0, -r * 0.55, r * 0.52, PALETTE.leaf],
      [-r * 0.12, -r * 0.05, r * 0.44, PALETTE.leaf],
    ];
    for (const [x, y, radius, color] of leaves) g.circle(x, y, radius).fill(color);
  },

  rug(g, w, h) {
    g.roundRect(-w / 2, -h / 2, w, h, 6).fill(PALETTE.carpet);
    g.roundRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 4).stroke({
      width: 2,
      color: PALETTE.terracotta,
      alpha: 0.45,
    });
    g.roundRect(-w / 2 + 18, -h / 2 + 18, w - 36, h - 36, 3).stroke({
      width: 1,
      color: PALETTE.oatmeal,
      alpha: 0.5,
    });
  },

  shelf(g, w, h) {
    g.roundRect(-w / 2, -h / 2, w, h, 3).fill(PALETTE.walnutDark);
    let x = -w / 2 + 6;
    let i = 0;
    while (x < w / 2 - 8) {
      const bookWidth = 5 + ((i * 7) % 6);
      g.roundRect(x, -h / 2 + 4, bookWidth, h - 8, 1).fill(SPINE_COLORS[i % SPINE_COLORS.length]);
      x += bookWidth + 2;
      i++;
    }
  },

  whiteboard(g, w, h) {
    g.roundRect(-w / 2, -h / 2, w, h, 2).fill(PALETTE.paper);
    g.roundRect(-w / 2, -h / 2, w, h, 2).stroke({ width: 1.5, color: PALETTE.brass });
  },

  bench(g, w, h) {
    g.roundRect(-w / 2, -h / 2, w, h, 5).fill(PALETTE.walnutLight);
    g.roundRect(-w / 2, -h / 2, w, h, 5).stroke({ width: 1.4, color: PALETTE.walnutDark });
    // Slats.
    for (let i = 1; i < 4; i++) {
      const x = -w / 2 + (w / 4) * i;
      g.moveTo(x, -h / 2 + 4).lineTo(x, h / 2 - 4);
    }
    g.stroke({ width: 1.2, color: PALETTE.walnutDark, alpha: 0.55 });
  },

  console(g, w, h) {
    g.roundRect(-w / 2, -h / 2, w, h, 4).fill(PALETTE.walnut);
    g.roundRect(-w / 2, -h / 2, w, h, 4).stroke({ width: 1.4, color: PALETTE.walnutDark });
    g.roundRect(-w / 2 + 8, -h / 2 + 7, w - 16, h - 14, 2).stroke({
      width: 1,
      color: PALETTE.walnutLight,
      alpha: 0.55,
    });
  },

  lamp(g, w) {
    const r = w / 2;
    g.circle(0, 0, r * 2.6).fill({ color: "#F6E2B8", alpha: 0.22 });
    g.circle(0, 0, r).fill(PALETTE.brass);
    g.circle(0, 0, r * 0.5).fill({ color: "#F6E2B8", alpha: 0.9 });
  },
};

/**
 * The colour of a piece's sides.
 *
 * Derived per kind rather than shared, because one walnut band under every
 * object makes upholstery and planters look like they are sitting on crates.
 */
const SIDE_COLOR: Record<FurnitureKind, string> = {
  desk: PALETTE.walnutDark,
  chair: PALETTE.oatmealDark,
  sofa: PALETTE.oatmealDark,
  armchair: PALETTE.oatmealDark,
  meetingTable: PALETTE.walnutDark,
  coffeeTable: PALETTE.walnutDark,
  stool: PALETTE.oatmealDark,
  counter: PALETTE.oatmealDark,
  plant: "#8A5238",
  rug: PALETTE.carpet,
  shelf: PALETTE.walnutDark,
  whiteboard: "#6A5238",
  lamp: "#8A6D40",
  bench: PALETTE.walnutDark,
  console: PALETTE.walnutDark,
};

/** Rugs lie under everything; drawing order is otherwise as authored. */
export function isUnderlay(kind: FurnitureKind): boolean {
  return kind === "rug";
}

/**
 * Build a piece, extruded.
 *
 * Three passes: a contact shadow on the floor, a dark silhouette of the shape at
 * the footprint, and the real shape raised by the kind's height. The gap between
 * the last two is what the eye reads as the side of the object — far cheaper
 * than modelling each side, and it works for any silhouette.
 *
 * Rotation is applied to the whole container, so an item's sides stay consistent
 * with the way it is turned.
 */
export function build(item: Furniture): Container {
  const size = FURNITURE_SIZE[item.kind];
  const w = item.w ?? size.w;
  const h = item.h ?? size.h;
  const lift = FURNITURE_HEIGHT[item.kind];

  const view = new Container();

  if (!isUnderlay(item.kind)) {
    const shadow = new Graphics();
    shadow
      .roundRect(-w / 2 + 3, -h / 2 + 5, w, h, 8)
      .fill({ color: PALETTE.shadow, alpha: 0.16 });
    view.addChild(shadow);
  }

  if (lift > 0) {
    // The side: one band spanning from the raised top down to the footprint.
    // Darker at the foot, which is all the shading a piece this size needs.
    const side = new Graphics();
    side.roundRect(-w / 2, -h / 2 - lift, w, h + lift, 6).fill(SIDE_COLOR[item.kind]);
    side
      .roundRect(-w / 2, h / 2 - lift * 0.5, w, lift * 0.5 + h / 2, 6)
      .fill({ color: PALETTE.shadow, alpha: 0.28 });
    view.addChild(side);
  }

  const top = new Graphics();
  DRAW[item.kind](top, w, h);
  top.y = -lift;
  view.addChild(top);

  view.position.set(item.x, item.y);
  view.rotation = item.rotation ?? 0;
  return view;
}
