import { WALL_HEIGHT, type Floor, type Furniture } from "./types";

/**
 * WovenTex HQ.
 *
 * A single floor of roughly 30 × 20 metres at 85 world units per metre. Edit
 * this file to rearrange the office, then run `npm run verify:floor` — it
 * catches a door too narrow to walk through or a desk that seals a room, both
 * of which are invisible in source and obvious in play.
 *
 * Solid furniture is what stops the floor feeling like a car park. Chairs,
 * rugs, plants and anything wall-mounted are deliberately not solid, so nobody
 * gets wedged behind a stool.
 */

const WALL = 14;

/** Degrees read better than radians when laying out a room by hand. */
const deg = (d: number) => (d * Math.PI) / 180;

/* ── Layout constants ─────────────────────────────────────────────── */

const W = 2600;
const H = 1700;

/** The sealed rooms all sit in a stack down the right-hand side. */
const ROOM_LEFT = 1800;

/* ── Composition helpers ──────────────────────────────────────────── */

/** Height of the desk surface, in world units — where a topper sits. */
const DESK_TOP = 62;

/**
 * A bank of four desks, back to back in two rows, with a screen between them.
 *
 * Each desk carries a storage unit on its surface, set toward the back so the
 * near half stays clear to work on.
 */
function deskBank(cx: number, cy: number): Furniture[] {
  const out: Furniture[] = [];

  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const x = cx + sx * 74;
      const y = cy + sz * 45;
      const facing = sz < 0 ? 0 : deg(180);

      out.push({ kind: "desk", x, y, rotation: facing, solid: true });
      out.push({ kind: "deskTopper", x, y: y - sz * 10, rotation: facing, elevation: DESK_TOP });
      out.push({ kind: "chair", x, y: y + sz * 64, rotation: facing });
      out.push({ kind: "deskLamp", x: x + 52, y: y - sz * 18 });
    }
  }

  // The screen down the middle is what makes a bank read as a bank.
  out.push({ kind: "partition", x: cx, y: cy, solid: true });
  return out;
}

/** Chairs evenly along both long sides of a table. */
function seatsAround(cx: number, cy: number, spread: number, offset: number, perSide: number): Furniture[] {
  const out: Furniture[] = [];
  for (let i = 0; i < perSide; i++) {
    const t = perSide === 1 ? 0.5 : i / (perSide - 1);
    const x = cx - spread / 2 + t * spread;
    out.push({ kind: "chair", x, y: cy - offset, rotation: 0 });
    out.push({ kind: "chair", x, y: cy + offset, rotation: deg(180) });
  }
  return out;
}

/** Sofa, two armchairs and a table around a rug. */
function loungeSet(cx: number, cy: number, rug: string, sofa?: string): Furniture[] {
  return [
    { kind: "rug", x: cx, y: cy, model: rug },
    { kind: "sofa", x: cx, y: cy - 120, solid: true, model: sofa },
    { kind: "pillow", x: cx - 50, y: cy - 118 },
    { kind: "pillow", x: cx + 50, y: cy - 118 },
    { kind: "armchair", x: cx - 140, y: cy + 40, rotation: deg(70), solid: true },
    { kind: "armchair", x: cx + 140, y: cy + 40, rotation: deg(-70), solid: true, model: "armchair-b" },
    { kind: "coffeeTable", x: cx, y: cy + 30, solid: true },
  ];
}

/* ── The floor ────────────────────────────────────────────────────── */

export const woventexFloor: Floor = {
  id: "hq",
  name: "WovenTex HQ",
  width: W,
  height: H,

  // Just inside the front doors — you arrive at the entrance and walk in,
  // rather than materialising in the middle of the room.
  spawn: { x: 170, y: 870 },

  /** Glazed double doors on the left wall. Decorative; the wall stays solid. */
  entrance: { x: 0, y: 760, w: WALL, h: 220 },

  walls: [
    // Shell. The north elevation is fully glazed — it is the long face of the
    // building, and glass there is most of what stops the plan feeling sealed.
    { x: 0, y: 0, w: W, h: WALL, glass: true },
    { x: 0, y: H - WALL, w: W, h: WALL },
    { x: 0, y: 0, w: WALL, h: H },
    { x: W - WALL, y: 0, w: WALL, h: H },

    // The three rooms are glazed partitions, so the floor stays legible
    // from anywhere and you can see whether a room is occupied before you walk
    // over. They still seal audio.
    // Meeting room, door on its left wall.
    { x: ROOM_LEFT, y: 60, w: W - ROOM_LEFT - WALL, h: WALL, glass: true },
    { x: ROOM_LEFT, y: 546, w: W - ROOM_LEFT - WALL, h: WALL, glass: true },
    { x: ROOM_LEFT, y: 60, w: WALL, h: 190, glass: true },
    { x: ROOM_LEFT, y: 350, w: WALL, h: 210, glass: true },

    // Focus room.
    { x: ROOM_LEFT, y: 660, w: W - ROOM_LEFT - WALL, h: WALL, glass: true },
    { x: ROOM_LEFT, y: 1046, w: W - ROOM_LEFT - WALL, h: WALL, glass: true },
    { x: ROOM_LEFT, y: 660, w: WALL, h: 140, glass: true },
    { x: ROOM_LEFT, y: 900, w: WALL, h: 160, glass: true },

    // Breakout room.
    { x: ROOM_LEFT, y: 1160, w: W - ROOM_LEFT - WALL, h: WALL, glass: true },
    { x: ROOM_LEFT, y: 1626, w: W - ROOM_LEFT - WALL, h: WALL, glass: true },
    { x: ROOM_LEFT, y: 1160, w: WALL, h: 150, glass: true },
    { x: ROOM_LEFT, y: 1410, w: WALL, h: 230, glass: true },
  ],

  zones: [
    { id: "meeting", name: "Meeting Room", x: 1814, y: 74, w: 772, h: 472 },
    { id: "focus", name: "Focus Room", x: 1814, y: 674, w: 772, h: 372 },
    { id: "breakout", name: "Breakout", x: 1814, y: 1174, w: 772, h: 452 },
  ],

  doors: [
    { id: "meeting-door", zoneId: "meeting", x: ROOM_LEFT, y: 250, w: WALL, h: 100 },
    { id: "focus-door", zoneId: "focus", x: ROOM_LEFT, y: 800, w: WALL, h: 100 },
    { id: "breakout-door", zoneId: "breakout", x: ROOM_LEFT, y: 1310, w: WALL, h: 100 },
  ],

  areas: [
    { id: "entrance", label: "Entrance", x: 40, y: 700, w: 400, h: 320, material: "tile" },
    { id: "kitchen", label: "Kitchen", x: 60, y: 60, w: 520, h: 380, material: "tile" },
    { id: "lounge", label: "Lounge", x: 60, y: 1160, w: 520, h: 480, material: "carpet" },
    { id: "studio", label: "Studio Floor", x: 660, y: 280, w: 1040, h: 1140, material: "carpet" },
  ],

  furniture: [
    /* ── Entrance ─────────────────────────────────────────────────── */
    { kind: "rug", x: 210, y: 870, model: "rug-b" },
    // Along the top of the lobby, not across it: turned side-on it narrows the
    // lane out of the front doors to less than a comfortable stride.
    { kind: "console", x: 300, y: 720, solid: true },
    { kind: "armchair", x: 120, y: 990, rotation: deg(-30), solid: true },
    { kind: "plant", x: 400, y: 1000, model: "tree" },
    { kind: "plant", x: 90, y: 720, model: "plant-c" },
    { kind: "wallArt", x: 240, y: 30, model: "wall-art" },

    /* ── Kitchen ──────────────────────────────────────────────────── */
    { kind: "counter", x: 300, y: 110, solid: true, model: "kitchen-run" },
    { kind: "roundTable", x: 320, y: 320, solid: true },
    { kind: "stool", x: 200, y: 320 },
    { kind: "stool", x: 440, y: 320 },
    { kind: "stool", x: 320, y: 200 },
    { kind: "stool", x: 320, y: 440 },
    { kind: "locker", x: 545, y: 130, rotation: deg(-90), solid: true },
    { kind: "waterCooler", x: 545, y: 400 },
    { kind: "plant", x: 90, y: 420, model: "plant-b" },

    /* ── Studio floor: four desk banks ────────────────────────────── */
    ...deskBank(900, 520),
    ...deskBank(1400, 520),
    ...deskBank(900, 1050),
    ...deskBank(1400, 1050),

    { kind: "printer", x: 700, y: 330, solid: true },
    { kind: "shelf", x: 1150, y: 300, solid: true },
    { kind: "shelf", x: 1150, y: 1400, rotation: deg(180), solid: true, model: "shelf-b" },
    { kind: "waterCooler", x: 1660, y: 800 },
    { kind: "plant", x: 700, y: 1390, model: "tree" },
    { kind: "plant", x: 1650, y: 320, model: "plant-big" },
    { kind: "plant", x: 700, y: 800, model: "plant-c" },
    { kind: "plant", x: 1650, y: 1390, model: "plant-b" },
    // Horizontal, not vertical: turned the other way it walls off the corridor
    // between the desk banks, which the flood fill allows but nobody enjoys.
    { kind: "benchDesk", x: 1150, y: 700, solid: true },
    { kind: "chair", x: 1070, y: 640 },
    { kind: "chair", x: 1230, y: 640 },
    { kind: "wallArt", x: 1000, y: 30 },
    { kind: "wallArt", x: 1400, y: 30, model: "wall-art-b" },

    /* ── Meeting room ─────────────────────────────────────────────── */
    { kind: "meetingTable", x: 2180, y: 300, solid: true },
    ...seatsAround(2180, 300, 200, 105, 3),
    { kind: "tv", x: 2180, y: 96 },
    { kind: "console", x: 2450, y: 500, solid: true },
    { kind: "plant", x: 2530, y: 130, model: "plant-big" },
    { kind: "plant", x: 1900, y: 480, model: "tree" },
    { kind: "wallArt", x: 1980, y: 96, model: "wall-art-b" },

    /* ── Focus room: quiet desks along the far wall ───────────────── */
    { kind: "desk", x: 1980, y: 760, solid: true, model: "desk-c" },
    { kind: "chair", x: 1980, y: 838, rotation: deg(180) },
    { kind: "deskLamp", x: 2032, y: 738 },
    { kind: "desk", x: 2200, y: 760, solid: true },
    { kind: "chair", x: 2200, y: 838, rotation: deg(180) },
    { kind: "desk", x: 2420, y: 760, solid: true, model: "desk-b" },
    { kind: "chair", x: 2420, y: 838, rotation: deg(180) },
    { kind: "deskLamp", x: 2472, y: 738 },
    { kind: "shelf", x: 2200, y: 1020, rotation: deg(180), solid: true },
    { kind: "plant", x: 1870, y: 1000, model: "plant-c" },
    { kind: "lamp", x: 2540, y: 1000, model: "floor-lamp-b" },

    /* ── Breakout ─────────────────────────────────────────────────── */
    ...loungeSet(2120, 1420, "rug-c", "sofa-b"),
    { kind: "stool", x: 2400, y: 1300 },
    { kind: "stool", x: 2470, y: 1360 },
    { kind: "tv", x: 2120, y: 1196 },
    { kind: "shelf", x: 2450, y: 1600, rotation: deg(180), solid: true, model: "shelf-b" },
    { kind: "plant", x: 1880, y: 1580, model: "tree" },
    { kind: "lamp", x: 1880, y: 1230 },

    /* ── Lounge ───────────────────────────────────────────────────── */
    ...loungeSet(300, 1400, "rug"),
    { kind: "lamp", x: 90, y: 1230 },
    { kind: "shelf", x: 300, y: 1610, rotation: deg(180), solid: true },
    { kind: "tv", x: 300, y: 1200 },
    { kind: "plant", x: 530, y: 1600, model: "plant-big" },
    { kind: "plant", x: 90, y: 1600, model: "tree" },
  ],

  /**
   * Signage, mounted on the front face of a wall. The big one faces the
   * entrance across the studio floor.
   */
  signs: [
    { id: "brand", x: 940, y: WALL, w: 420, h: WALL_HEIGHT, text: "WOVENTEX", mark: true },
    { id: "meeting-plaque", x: 1826, y: 60 + WALL, w: 180, h: WALL_HEIGHT, text: "MEETING" },
    { id: "focus-plaque", x: 1826, y: 660 + WALL, w: 180, h: WALL_HEIGHT, text: "FOCUS" },
    { id: "breakout-plaque", x: 1826, y: 1160 + WALL, w: 180, h: WALL_HEIGHT, text: "BREAKOUT" },
  ],
};
