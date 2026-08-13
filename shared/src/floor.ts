/**
 * The WovenTex floor.
 *
 * This is deliberately a source file rather than an editor-backed database
 * record. A five-person team rearranges its office roughly twice a year, and a
 * drag-and-drop editor is several weeks of work — so the office is a diff.
 *
 * Coordinate space is world pixels, origin top-left. One "step" is ~240px/sec.
 */

import type { Floor } from "./types";

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
  spawn: { x: 300, y: 520 },

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
    { id: "kitchen", label: "Kitchen", x: 60, y: 60, w: 340, h: 260 },
    { id: "studio", label: "Studio Floor", x: 470, y: 330, w: 500, h: 340 },
    { id: "lounge", label: "Lounge", x: 60, y: 680, w: 380, h: 250 },
  ],
};
