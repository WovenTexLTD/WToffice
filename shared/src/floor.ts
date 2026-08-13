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

/** Height of the desk surface, in world units — where a monitor sits. */
const DESK_TOP = 62;

/**
 * A bank of four workstations: two pairs, each sitting opposite each other.
 *
 * Two desks pushed back to back with a screen between them is the standard
 * bench arrangement, and it reads far better than rows all facing one way —
 * people are grouped into pairs that face each other, which is what a desk
 * cluster is for.
 *
 * Monitors go against the screen; chairs sit on the outside of each desk so
 * whoever is in one faces their own desk. The screen mounts on the desks rather
 * than standing on the floor, which is what this partition is sized for.
 */
function deskBank(cx: number, cy: number): Furniture[] {
  const out: Furniture[] = [];
  const PITCH = 168;
  /**
   * Half the depth of a desk, so the pair butt together. A gap between them
   * leaves the shared screen supported by nothing, and it hovers.
   */
  const REACH = 28;
  const SEAT = 100;

  for (const side of [-0.5, 0.5]) {
    const x = cx + side * PITCH;

    // North desk: whoever sits here is above it, facing south.
    out.push({ kind: "desk", x, y: cy - REACH, rotation: deg(180), solid: true });
    out.push({ kind: "monitor", x, y: cy - 24, rotation: deg(180), elevation: DESK_TOP });
    out.push({ kind: "chair", x, y: cy - SEAT });

    // The screen they share, sitting on the desks between them.
    // Set into the desks rather than perched on them: the base disappears
    // behind the desk edge and the panel stands about 40cm proud, which is what
    // a desk screen looks like.
    out.push({ kind: "partition", x, y: cy, elevation: 34 });

    // South desk: whoever sits here is below it, facing north.
    out.push({ kind: "desk", x, y: cy + REACH, solid: true });
    out.push({ kind: "monitor", x, y: cy + 24, elevation: DESK_TOP });
    out.push({ kind: "chair", x, y: cy + SEAT, rotation: deg(180) });

    out.push({ kind: "deskLamp", x: x + 54, y: cy - REACH - 14, elevation: DESK_TOP });
  }
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

/**
 * Sofa, two armchairs and a table around a rug.
 *
 * Two things worth stating, because both were wrong first time.
 *
 * The rotation sign: the renderer applies `rotation.y = -rotation`, so a
 * positive angle turns a chair *away* from the centre. The armchairs flank the
 * table, so the left one turns negative and the right one positive.
 *
 * The spacing: tight enough to talk across, loose enough to walk between. The
 * first pass was a showroom and the second was a huddle — a seat needs about
 * half a metre of clearance from the table, not none.
 */
function loungeSet(cx: number, cy: number, rug: string, sofa?: string): Furniture[] {
  return [
    { kind: "rug", x: cx, y: cy, model: rug },

    { kind: "sofa", x: cx, y: cy - 96, solid: true, model: sofa },
    { kind: "pillow", x: cx - 46, y: cy - 94 },
    { kind: "pillow", x: cx + 46, y: cy - 94 },

    // Negative turns left-hand seating toward the middle; positive turns right.
    { kind: "armchair", x: cx - 118, y: cy + 20, rotation: deg(-68), solid: true },
    { kind: "armchair", x: cx + 118, y: cy + 20, rotation: deg(68), solid: true },

    { kind: "coffeeTable", x: cx, y: cy + 2, solid: true },
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
    { id: "meeting", name: "Meeting Room", x: 1814, y: 74, w: 772, h: 472, material: "walnut" },
    { id: "focus", name: "Focus Room", x: 1814, y: 674, w: 772, h: 372, material: "walnut" },
    { id: "breakout", name: "Breakout", x: 1814, y: 1174, w: 772, h: 452, material: "walnut" },
  ],

  doors: [
    { id: "meeting-door", zoneId: "meeting", x: ROOM_LEFT, y: 250, w: WALL, h: 100 },
    { id: "focus-door", zoneId: "focus", x: ROOM_LEFT, y: 800, w: WALL, h: 100 },
    { id: "breakout-door", zoneId: "breakout", x: ROOM_LEFT, y: 1310, w: WALL, h: 100 },
  ],

  // Boards throughout, with the areas laid over the top.
  groundMaterial: "oak",

  areas: [
    { id: "entrance", label: "Entrance", x: 40, y: 700, w: 400, h: 320, material: "tile" },
    { id: "kitchen", label: "Kitchen", x: 60, y: 60, w: 520, h: 380, material: "tile" },
    { id: "lounge", label: "Lounge", x: 60, y: 1160, w: 520, h: 480, material: "carpet" },
    // The warm boards, matching the rooms — the pale ones outside then read as
    // circulation around the places people actually work.
    { id: "studio", label: "Studio Floor", x: 700, y: 340, w: 960, h: 1020, material: "walnut" },
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

    /* ── Studio floor: two desk banks, eight workstations ─────────── */
    ...deskBank(900, 520),
    ...deskBank(1400, 520),

    { kind: "wallArt", x: 1000, y: 30 },
    { kind: "wallArt", x: 1400, y: 30, model: "wall-art-b" },

    /* ── Hangout, filling the lower half of the studio ────────────── */

    // A low bookcase screens the social end from the desks. Waist height, so
    // it separates the two without walling either of them in — which is the
    // whole trick with an open plan.
    { kind: "shelf", x: 1080, y: 800, solid: true },
    { kind: "shelf", x: 1280, y: 800, solid: true },
    { kind: "plant", x: 1180, y: 795, model: "plant-big" },

    // Sofa, two armchairs and a table around a rug — a closed conversation
    // group, everything facing in.
    ...loungeSet(1180, 1070, "rug-round"),

    // Informal seating on the open side, where a chair would feel too formal.
    // The pack has no bean bags; soft cubes and a floor cushion are the nearest
    // thing, and they sit better with the rest of the group than a novelty
    // shape would.
    // A pair pulled up on one side and a cushion on the other. Spaced evenly in
    // a symmetric arc they read as three abandoned boxes; grouped unevenly they
    // read as seats someone moved.
    { kind: "softCube", x: 1042, y: 1196, rotation: deg(-22) },
    { kind: "softCube", x: 1108, y: 1224, rotation: deg(-8) },
    { kind: "softCube", x: 1312, y: 1192, rotation: deg(26) },

    // Beside the sofa, where a lamp belongs. On its own in the middle of the
    // floor it just reads as an object.
    { kind: "lamp", x: 1058, y: 962 },
    { kind: "console", x: 1610, y: 940, rotation: deg(90), solid: true },
    { kind: "plant", x: 1610, y: 850, model: "plant-big" },
    { kind: "plant", x: 780, y: 1230, model: "tree" },
    { kind: "plant", x: 1560, y: 1250, model: "plant-b" },

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
