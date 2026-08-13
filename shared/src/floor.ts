/**
 * The WovenTex floor.
 *
 * This is deliberately a source file rather than an editor-backed database
 * record. A five-person team rearranges its office roughly twice a year, and a
 * drag-and-drop editor is several weeks of work — so the office is a diff.
 *
 * Coordinate space is world pixels, origin top-left. One "step" is ~240px/sec.
 */

import { WALL_HEIGHT, type Floor, type Furniture } from "./types";

/** Degrees read better than radians when laying out a room by hand. */
const deg = (d: number) => (d * Math.PI) / 180;

/** A desk with its chair tucked in on the given side. */
function workstation(x: number, y: number, facing: "up" | "down"): Furniture[] {
  const offset = facing === "up" ? 52 : -52;
  return [
    { kind: "desk", x, y, solid: true },
    { kind: "chair", x, y: y + offset, rotation: facing === "up" ? 0 : deg(180) },
  ];
}

const WALL = 14;
const W = 1600;
const H = 1000;

/** Right edge of a room that abuts the outer right wall. */
const ROOM_LEFT = 1060;

export const woventexFloor: Floor = {
  id: "woventex-hq",
  name: "WovenTex HQ",
  width: W,
  height: H,
  // Just inside the front doors — you arrive at the entrance and walk in,
  // rather than materialising in the middle of the room.
  spawn: { x: 132, y: 520 },

  /** Glazed double doors on the left wall. Decorative; the wall stays solid. */
  entrance: { x: 0, y: 440, w: WALL, h: 170 },

  walls: [
    // Outer shell
    { x: 0, y: 0, w: W, h: WALL },
    { x: 0, y: H - WALL, w: W, h: WALL },
    { x: 0, y: 0, w: WALL, h: H },
    { x: W - WALL, y: 0, w: WALL, h: H },

    // ── Meeting Room (top right) — door gap on its left wall, y 210–300
    { x: ROOM_LEFT, y: 60, w: W - ROOM_LEFT - WALL, h: WALL }, // top
    { x: ROOM_LEFT, y: 446, w: W - ROOM_LEFT - WALL, h: WALL }, // bottom
    { x: ROOM_LEFT, y: 60, w: WALL, h: 150 }, // left, above door
    { x: ROOM_LEFT, y: 300, w: WALL, h: 160 }, // left, below door

    // ── Focus Room (bottom right) — door gap on its left wall, y 700–790
    { x: ROOM_LEFT, y: 560, w: W - ROOM_LEFT - WALL, h: WALL }, // top
    { x: ROOM_LEFT, y: 926, w: W - ROOM_LEFT - WALL, h: WALL }, // bottom
    { x: ROOM_LEFT, y: 560, w: WALL, h: 140 }, // left, above door
    { x: ROOM_LEFT, y: 790, w: WALL, h: 150 }, // left, below door
  ],

  /**
   * Sealed audio zones, inset to the inner face of each room's walls. Standing
   * in a doorway leaves you outside the zone, which is the behaviour you want:
   * you are not in the meeting until you have actually walked in.
   */
  zones: [
    { id: "meeting", name: "Meeting Room", x: ROOM_LEFT + WALL, y: 74, w: W - ROOM_LEFT - WALL * 2, h: 372 },
    { id: "focus", name: "Focus Room", x: ROOM_LEFT + WALL, y: 574, w: W - ROOM_LEFT - WALL * 2, h: 352 },
  ],

  doors: [
    { id: "meeting-door", zoneId: "meeting", x: ROOM_LEFT, y: 210, w: WALL, h: 90 },
    { id: "focus-door", zoneId: "focus", x: ROOM_LEFT, y: 700, w: WALL, h: 90 },
  ],

  areas: [
    { id: "entrance", label: "Entrance", x: 40, y: 400, w: 250, h: 250, material: "tile" },
    { id: "kitchen", label: "Kitchen", x: 60, y: 60, w: 340, h: 260, material: "tile" },
    { id: "studio", label: "Studio Floor", x: 470, y: 330, w: 500, h: 340, material: "oak" },
    { id: "lounge", label: "Lounge", x: 60, y: 680, w: 380, h: 250, material: "carpet" },
  ],

  /**
   * Furniture is what makes this read as an office rather than a floor plan.
   * Solid pieces are the ones you walk around; chairs, rugs and plants are not,
   * so nobody gets wedged behind a stool.
   */
  furniture: [
    // ── Entrance: mat, somewhere to sit, something green
    { kind: "rug", x: 130, y: 524, w: 128, h: 92 },
    // Against the back of the lobby. Anything solid in front of the doors would
    // sit squarely in the lane everyone walks when they arrive.
    { kind: "bench", x: 160, y: 415, solid: true },
    { kind: "plant", x: 246, y: 606 },
    { kind: "plant", x: 62, y: 640 },

    // ── Kitchen: counter along the top wall, table to eat at
    { kind: "counter", x: 230, y: 96, solid: true },
    { kind: "coffeeTable", x: 230, y: 232, solid: true },
    { kind: "stool", x: 158, y: 232 },
    { kind: "stool", x: 302, y: 232 },
    { kind: "plant", x: 108, y: 288 },

    // ── Studio floor: four workstations in two facing rows
    ...workstation(590, 400, "down"),
    ...workstation(850, 400, "down"),
    ...workstation(590, 600, "up"),
    ...workstation(850, 600, "up"),
    { kind: "shelf", x: 720, y: 344, solid: true },
    { kind: "plant", x: 500, y: 640 },
    { kind: "plant", x: 940, y: 360 },

    // ── Lounge: sofa and armchairs round a rug
    { kind: "rug", x: 248, y: 800 },
    { kind: "sofa", x: 248, y: 712, solid: true },
    { kind: "armchair", x: 120, y: 828, rotation: deg(90), solid: true },
    { kind: "armchair", x: 376, y: 828, rotation: deg(-90), solid: true },
    { kind: "coffeeTable", x: 248, y: 828, solid: true },
    { kind: "lamp", x: 120, y: 716 },
    { kind: "plant", x: 392, y: 716 },

    // ── Meeting room: a table you can walk right around
    { kind: "meetingTable", x: 1330, y: 250, solid: true },
    { kind: "chair", x: 1240, y: 168 },
    { kind: "chair", x: 1330, y: 168 },
    { kind: "chair", x: 1420, y: 168 },
    { kind: "chair", x: 1240, y: 332, rotation: deg(180) },
    { kind: "chair", x: 1330, y: 332, rotation: deg(180) },
    { kind: "chair", x: 1420, y: 332, rotation: deg(180) },
    // Clear of the wall's front face, which drops WALL_HEIGHT into the room.
    { kind: "whiteboard", x: 1330, y: 136 },
    { kind: "plant", x: 1530, y: 400 },
    { kind: "console", x: 1150, y: 400, solid: true },

    // ── Focus room: two quiet desks
    ...workstation(1220, 700, "down"),
    ...workstation(1440, 700, "down"),
    { kind: "shelf", x: 1330, y: 890, rotation: deg(180), solid: true },
    { kind: "lamp", x: 1120, y: 640 },
  ],

  /**
   * Signage, mounted on the front face of a wall. The big one sits above the
   * studio floor where it faces the entrance across the room.
   */
  signs: [
    { id: "brand", x: 620, y: WALL, w: 320, h: WALL_HEIGHT, text: "WOVENTEX", mark: true },
    { id: "meeting-plaque", x: 1086, y: 60 + WALL, w: 150, h: WALL_HEIGHT, text: "MEETING" },
    { id: "focus-plaque", x: 1086, y: 560 + WALL, w: 150, h: WALL_HEIGHT, text: "FOCUS" },
  ],
};
