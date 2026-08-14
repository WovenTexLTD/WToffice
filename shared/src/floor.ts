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

    // The rooms are glazed partitions, so the floor stays legible from anywhere
    // and you can see whether a room is occupied before you walk over. They
    // still seal audio.
    //
    // ABD's office takes the top-right corner, at the same 472 x 386 as
    // Karim's. The building's own north and east walls make two of its sides,
    // so it needs a west wall and a south one, with the door on the west like
    // the rooms stacked below it.
    { x: 2100, y: WALL, w: WALL, h: 186, glass: true },
    { x: 2100, y: 300, w: WALL, h: 114, glass: true },
    { x: 2100, y: 400, w: 486, h: WALL, glass: true },

    // The meeting room, centre top, at the size it always was: 772 x 472
    // inside. Its door is on the west wall so it is reached across the open
    // floor between it and Karim's office, which keeps its whole south
    // elevation solid glass onto the studio.
    { x: 780, y: WALL, w: WALL, h: 186, glass: true },
    { x: 780, y: 300, w: WALL, h: 200, glass: true },
    { x: 1566, y: WALL, w: WALL, h: 486, glass: true },
    { x: 780, y: 486, w: 800, h: WALL, glass: true },

    // Karim's office, top-left corner. Same idea as ABD's: the building's own
    // north and west glazing make two of its four walls.
    { x: 486, y: WALL, w: WALL, h: 400, glass: true },
    { x: WALL, y: 400, w: 196, h: WALL, glass: true },
    { x: 310, y: 400, w: 190, h: WALL, glass: true },

    // The focus and breakout rooms are one room now, and it sits lower than
    // either did: quiet desks along the top, seating at the bottom. One space
    // that seals as a unit rather than two that each seal half of it.
    { x: ROOM_LEFT, y: 800, w: W - ROOM_LEFT - WALL, h: WALL, glass: true },
    { x: ROOM_LEFT, y: 1626, w: W - ROOM_LEFT - WALL, h: WALL, glass: true },
    { x: ROOM_LEFT, y: 800, w: WALL, h: 350, glass: true },
    { x: ROOM_LEFT, y: 1250, w: WALL, h: 390, glass: true },
  ],

  zones: [
    { id: "meeting", name: "Meeting Room", x: 794, y: WALL, w: 772, h: 472, material: "walnut" },
    // Deliberately unnamed: the interface calls it "a room" and it gets no
    // plaque. The id is internal and never shown.
    { id: "annex", x: 1814, y: 814, w: 772, h: 812, material: "walnut" },
    { id: "karim", name: "Karim's Office", x: WALL, y: WALL, w: 472, h: 386, material: "walnut" },
    { id: "abd", name: "ABD's Office", x: 2114, y: WALL, w: 472, h: 386, material: "walnut" },
  ],

  doors: [
    { id: "meeting-door", zoneId: "meeting", x: 780, y: 200, w: WALL, h: 100 },
    { id: "annex-door", zoneId: "annex", x: ROOM_LEFT, y: 1150, w: WALL, h: 100 },
    { id: "karim-door", zoneId: "karim", x: 210, y: 400, w: 100, h: WALL },
    { id: "abd-door", zoneId: "abd", x: 2100, y: 200, w: WALL, h: 100 },
  ],

  // Boards throughout, with the areas laid over the top.
  groundMaterial: "oak",

  areas: [
    { id: "entrance", label: "Entrance", x: 40, y: 700, w: 400, h: 320, material: "tile" },
    { id: "lounge", label: "Lounge", x: 60, y: 1160, w: 520, h: 480, material: "carpet" },
    // The warm boards, matching the rooms — the pale ones outside then read as
    // circulation around the places people actually work.
    { id: "studio", label: "Studio Floor", x: 700, y: 610, w: 960, h: 900, material: "walnut" },
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

    /* ── Studio floor: two desk banks, eight workstations ─────────── */
    ...deskBank(900, 810),
    ...deskBank(1400, 810),

    /* ── Hangout, filling the lower half of the studio ────────────── */

    // Against the left of the studio rather than the middle of it, which leaves
    // the lower right open. Nothing screens it from the desks any more — the rug
    // draws the boundary on its own, and a bookcase across the room was doing
    // less work than it cost in floor.
    { kind: "areaRug", x: 978, y: 1280 },

    // The sofa is an L. Its two legs run along the top and left of the rug, so
    // the group's focus is the crook they enclose — not the middle of the rug,
    // which is where a straight sofa would have put it. Everything else rings
    // that crook from the open side.
    { kind: "sofa", x: 900, y: 1212, w: 207, h: 226, solid: true, model: "sofa-l" },
    { kind: "coffeeTable", x: 1008, y: 1300, solid: true },

    // Facing back into the crook. Rotation 0 faces north and negative turns
    // clockwise, so a seat east of the table needs +90 to look west.
    { kind: "armchair", x: 1128, y: 1265, w: 57, h: 69, rotation: deg(90), solid: true, model: "lounge-chair" },
    { kind: "armchair", x: 1086, y: 1412, w: 57, h: 69, rotation: deg(140), solid: true, model: "lounge-chair" },

    // Two stools closing the ring on the open side, for when the whole team is
    // in. Nothing sits off the rug: the point of it is that the group reads as
    // one place.
    { kind: "sideChair", x: 946, y: 1432, rotation: deg(180), solid: true },
    { kind: "sideChair", x: 844, y: 1404, rotation: deg(214), solid: true },

    // Tucked against the sofa's outer corner. A floor lamp standing on its own
    // a metre clear of the furniture reads as an object, not as a lamp.
    { kind: "lamp", x: 752, y: 1106 },

    /* ── Sample bay: where the fabric actually lives ──────────────── */

    // WovenTex makes textiles and the studio had nowhere to put them, which is
    // the sort of gap you only notice once the rest of the floor is furnished.
    //
    // The row sits at y 1000, not 880. At 880 the rails sealed the east-west
    // lane across the studio: you could still reach the meeting room by going
    // around, so `verify:floor` passed, and it took the smoke test actually
    // walking the route to find it. Everything here stays below y 917 so that
    // lane keeps a clear metre.
    //
    // The third rail is turned ten degrees out of line. A perfect row of three
    // reads as a shop; one off-angle reads as someone working through it.
    // Chairs on the north side, so whoever is working faces the rails rather
    // than turning their back on them. The bench drops 20 to buy the room:
    // tucked in above it, the chairs would otherwise crowd the east-west lane
    // at y 850. Rotation 0 faces south, which is what the desk banks use for
    // the seat above a desk.
    { kind: "benchDesk", x: 1400, y: 1170, solid: true },
    { kind: "chair", x: 1330, y: 1097 },
    { kind: "chair", x: 1462, y: 1097 },
    { kind: "fabricRoll", x: 1310, y: 1158, rotation: deg(18), elevation: 62 },
    { kind: "fabricRoll", x: 1352, y: 1172, rotation: deg(-12), elevation: 62, model: "fabric-roll-b" },
    { kind: "fabricRoll", x: 1394, y: 1156, rotation: deg(32), elevation: 62, model: "fabric-roll-c" },
    { kind: "fabricStack", x: 1470, y: 1170, rotation: deg(-8), elevation: 62 },
    { kind: "fabricStack", x: 1516, y: 1174, rotation: deg(14), elevation: 62, model: "fabric-stack-c" },

    // The rails behind the bench, against the bottom of the studio. The third
    // is turned ten degrees out of line: a perfect row of three reads as a
    // shop, one off-angle reads as someone working through it.
    { kind: "garmentRail", x: 1280, y: 1370, solid: true },
    { kind: "garmentRail", x: 1428, y: 1370, solid: true, model: "rail-b" },
    { kind: "garmentRail", x: 1578, y: 1370, rotation: deg(-10), solid: true, model: "rail-c" },

    // Stock crates on the floor, one with a bolt left on top of it.
    { kind: "crate", x: 1608, y: 1145, rotation: deg(8), solid: true },
    { kind: "fabricStack", x: 1608, y: 1145, rotation: deg(-14), elevation: 29 },
    { kind: "crate", x: 1600, y: 1222, rotation: deg(-6), solid: true, model: "crate-b" },
    { kind: "crate", x: 1250, y: 1238, rotation: deg(14), solid: true, model: "crate-b" },
    { kind: "fabricStack", x: 1250, y: 1238, rotation: deg(24), elevation: 29, model: "fabric-stack-c" },

    /* ── Karim's office ───────────────────────────────────────────── */

    // Stripped back to the desk and the table on the west wall. The chair sits
    // behind the desk facing the door, so whoever is in the room looks at
    // whoever comes in rather than at the window.
    { kind: "desk", x: 250, y: 150, rotation: deg(180), solid: true, model: "office-desk" },
    { kind: "monitor", x: 250, y: 154, rotation: deg(180), elevation: DESK_TOP },
    { kind: "chair", x: 250, y: 78, model: "desk-chair" },
    { kind: "coffeeTable", x: 34, y: 207, rotation: deg(90), w: 77, h: 29, solid: true, model: "side-table" },
    // North-west corner, turned so its face is flat to the west wall.
    { kind: "instrument", x: 22, y: 52, rotation: deg(-90) },
    { kind: "instrument", x: 22, y: 92, rotation: deg(-90), w: 33, h: 7, model: "instrument-b" },
    // Under the desk and the chair behind it: 1.60 x 1.83m covers both.
    { kind: "officeRug", x: 250, y: 114 },
    { kind: "tv", x: 22, y: 252, rotation: deg(-90), elevation: 72, model: "wall-screen" },

    /* ── ABD's office ─────────────────────────────────────────────── */

    // Same kit as Karim's, laid out the other way round because the door is on
    // the west wall rather than the south: the shelf takes the far wall and the
    // armchair the far corner, so the lane in from the door stays clear.
    { kind: "desk", x: 2350, y: 150, rotation: deg(180), solid: true, model: "office-desk" },
    { kind: "monitor", x: 2350, y: 154, rotation: deg(180), elevation: DESK_TOP },
    { kind: "deskLamp", x: 2416, y: 136, elevation: DESK_TOP },
    { kind: "chair", x: 2350, y: 78, model: "desk-chair" },
    { kind: "chair", x: 2270, y: 250, rotation: deg(180), w: 59, h: 55, model: "visitor-chair" },
    { kind: "chair", x: 2430, y: 250, rotation: deg(180), w: 59, h: 55, model: "visitor-chair" },
    { kind: "shelf", x: 2560, y: 300, rotation: deg(-90), solid: true },
    { kind: "armchair", x: 2440, y: 350, rotation: deg(50), solid: true },
    { kind: "lamp", x: 2340, y: 340 },
    { kind: "plant", x: 2150, y: 70, model: "plant-c" },

    /* ── Meeting room ─────────────────────────────────────────────── */

    // The table sits east of the doorway so you walk in beside it rather than
    // into the back of a chair.
    { kind: "meetingTable", x: 1240, y: 250, solid: true },
    ...seatsAround(1240, 250, 200, 105, 3),
    { kind: "tv", x: 1240, y: 30 },
    { kind: "console", x: 1530, y: 250, rotation: deg(-90), solid: true },
    { kind: "plant", x: 1500, y: 430, model: "tree" },
    { kind: "plant", x: 880, y: 80, model: "plant-big" },

    /* ── The unnamed room ─────────────────────────────────────────── */

    // Both halves of what used to be two rooms, in one space: quiet desks along
    // the north wall, seating at the south end, and the doorway between them so
    // nobody crosses either half to reach the other.
    { kind: "desk", x: 1980, y: 900, solid: true, model: "desk-c" },
    { kind: "chair", x: 1980, y: 978, rotation: deg(180) },
    { kind: "deskLamp", x: 2032, y: 878 },
    { kind: "desk", x: 2200, y: 900, solid: true },
    { kind: "chair", x: 2200, y: 978, rotation: deg(180) },
    { kind: "desk", x: 2420, y: 900, solid: true, model: "desk-b" },
    { kind: "chair", x: 2420, y: 978, rotation: deg(180) },
    { kind: "deskLamp", x: 2472, y: 878 },
    { kind: "shelf", x: 2560, y: 1080, rotation: deg(-90), solid: true },
    { kind: "plant", x: 1870, y: 900, model: "plant-c" },
    { kind: "lamp", x: 2540, y: 1560, model: "floor-lamp-b" },

    // The seating end. The sofa faces south, so the screen goes on the south
    // wall in front of it rather than on the wall the room lost.
    ...loungeSet(2160, 1400, "rug-c", "sofa-b"),
    { kind: "stool", x: 2350, y: 1332 },
    { kind: "stool", x: 2404, y: 1386 },
    { kind: "tv", x: 2160, y: 1600 },
    { kind: "plant", x: 1880, y: 1580, model: "tree" },
    { kind: "lamp", x: 1880, y: 1240 },

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
    { id: "brand", x: 430, y: WALL, w: 420, h: WALL_HEIGHT, text: "WOVENTEX", mark: true },
    { id: "meeting-plaque", x: 806, y: 34, w: 180, h: WALL_HEIGHT, text: "MEETING" },
    { id: "karim-plaque", x: 310, y: 418, w: 180, h: WALL_HEIGHT, text: "KARIM" },
    { id: "abd-plaque", x: 2126, y: 34, w: 180, h: WALL_HEIGHT, text: "ABD" },
  ],
};
