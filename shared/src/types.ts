/** Core geometry and world types shared by client and server. */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A sealed audio zone. Membership beats distance: two people in the same zone
 * hear each other at full volume regardless of separation, and hear nobody
 * outside it. This is the single rule that makes meeting rooms work.
 */
export interface Zone extends Rect {
  id: string;
  /**
   * Optional, because a room does not have to be called anything. Without one
   * the interface says "a room" rather than naming it, and no plaque is hung.
   */
  name?: string;
  material: Material;
}

/** A gap in a zone's wall. Openable doors land in Phase 4; for now these are always open. */
export interface Door extends Rect {
  id: string;
  zoneId: string;
}

/**
 * A wall.
 *
 * Glazing is purely a matter of how it is drawn — a glass wall still blocks
 * movement, and a glass meeting room still seals audio, exactly as a solid one
 * does. Real glazed partitions are sound-isolated too.
 */
export interface Wall extends Rect {
  glass?: boolean;
}

/** Ground covering. Purely visual, but it is most of what makes a room read. */
/**
 * Ground coverings.
 *
 * Two woods, deliberately: pale boards outside the rooms and a warmer brown
 * inside them, which is what separates the circulation from the places you
 * work without needing a change of material.
 */
export type Material = "oak" | "walnut" | "carpet" | "carpetDark" | "tile" | "concrete";

/** Named open areas — kitchen, lounge. No behaviour, purely wayfinding. */
export interface Area extends Rect {
  id: string;
  label: string;
  /** Procedural covering, used when no `model` is named. */
  material: Material;
  /**
   * A floor model from the pack, tiled across the area instead.
   *
   * Packs ship floors as a square tile meant to repeat; naming one here tiles
   * it over this area only. Falls back to `material` if it cannot be loaded.
   */
  model?: string;
}

/**
 * How tall walls appear, in world pixels.
 *
 * Purely visual: walls are drawn with a lit top face and a shaded front face
 * dropping this far toward the viewer, which is what stops a floor plan reading
 * as tape on the ground. Collision still uses the flat footprint.
 *
 * Furniture within this distance below a wall will be covered by its face.
 */
export const WALL_HEIGHT = 44;

/** Wall-mounted signage — the brand panel, room plaques. */
export interface Sign extends Rect {
  id: string;
  text: string;
  /** Draws the woven mark alongside the text. */
  mark?: boolean;
}

export type FurnitureKind =
  | "desk"
  | "chair"
  | "sofa"
  | "armchair"
  | "meetingTable"
  | "coffeeTable"
  | "stool"
  | "counter"
  | "plant"
  | "rug"
  | "shelf"
  | "whiteboard"
  | "lamp"
  | "bench"
  | "console"
  | "partition"
  | "wallArt"
  | "locker"
  | "pillow"
  | "deskLamp"
  | "tv"
  | "printer"
  | "waterCooler"
  | "roundTable"
  | "benchDesk"
  | "monitor"
  | "softCube"
  | "floorCushion"
  | "sideChair"
  | "areaRug"
  | "garmentRail"
  | "fabricRoll"
  | "fabricStack"
  | "crate"
  | "instrument"
  | "officeRug"
  | "redChair"
  | "tvWall"
  | "gadget"
  | "meetingRug"
  | "poolTable"
  | "arcade"
  | "vending"
  | "gameTable"
  | "doormat";

export interface Furniture {
  kind: FurnitureKind;
  x: number;
  y: number;
  /** Radians. Rotation is about the item's centre. */
  rotation?: number;
  /** Overrides the kind's default footprint. */
  w?: number;
  h?: number;
  /**
   * Overrides the kind's default model.
   *
   * Variety is what stops a furnished room reading as copy-paste: four desks
   * that are the same object four times look wrong in a way one desk never
   * does. Names a file in web/public/models without the extension.
   */
  model?: string;
  /**
   * Height above the floor, in world units.
   *
   * For things that sit on other things — a monitor riser on a desk. The model
   * is placed with its base at this height rather than on the ground.
   */
  elevation?: number;
  /**
   * Whether you have to walk around it.
   *
   * Solid furniture is what stops the floor feeling like an empty car park, but
   * every solid item is also a chance to seal a room off — run
   * `npm run verify:floor` after moving anything.
   */
  solid?: boolean;
}

export interface Floor {
  id: string;
  name: string;
  width: number;
  height: number;
  spawn: Vec2;
  walls: Wall[];
  zones: Zone[];
  doors: Door[];
  areas: Area[];
  furniture: Furniture[];
  signs: Sign[];
  /** Covering for everything outside the named areas. */
  groundMaterial: Material;
  /** A floor model tiled over the ground instead, if one suits better. */
  groundModel?: string;
  /**
   * Glazed doors drawn over a stretch of outer wall. Decorative — the wall
   * behind stays solid, because there is nowhere to go.
   */
  entrance: Rect;
}

/**
 * Footprints, in world pixels.
 *
 * Taken from each bought model's real size at 85 world units per metre, so
 * collision matches what is drawn. Measure a replacement before swapping it in:
 *   node tools/inspect-models.mjs <pack-dir> <prefix> --zup
 */
export const FURNITURE_SIZE: Record<FurnitureKind, { w: number; h: number }> = {
  desk: { w: 134, h: 56 }, //          1.58 × 0.66 m
  chair: { w: 54, h: 56 }, //          0.63 × 0.66 m
  sofa: { w: 174, h: 74 }, //          2.05 × 0.87 m
  armchair: { w: 56, h: 60 }, //       0.66 × 0.70 m
  meetingTable: { w: 163, h: 121 }, // 1.92 × 1.42 m
  coffeeTable: { w: 77, h: 77 }, //    0.90 × 0.90 m
  stool: { w: 30, h: 30 }, //          0.35 × 0.35 m
  counter: { w: 281, h: 48 }, //       3.30 × 0.57 m
  plant: { w: 58, h: 49 }, //          0.68 × 0.58 m
  rug: { w: 252, h: 172 }, //          2.97 × 2.02 m
  shelf: { w: 112, h: 20 }, //         1.32 × 0.23 m
  whiteboard: { w: 170, h: 14 }, //    still a primitive
  lamp: { w: 49, h: 48 }, //           0.58 × 0.56 m
  bench: { w: 82, h: 31 }, //          0.97 × 0.36 m
  console: { w: 105, h: 30 }, //       1.24 × 0.35 m
  partition: { w: 161, h: 5 }, //      1.89 × 0.06 m
  wallArt: { w: 107, h: 7 }, //        1.26 × 0.08 m
  locker: { w: 72, h: 32 }, //         0.85 × 0.38 m
  pillow: { w: 36, h: 26 }, //         0.42 × 0.31 m
  deskLamp: { w: 21, h: 21 }, //       0.25 × 0.25 m
  tv: { w: 115, h: 22 }, //            1.35 × 0.26 m
  printer: { w: 60, h: 37 }, //        0.70 × 0.44 m
  waterCooler: { w: 43, h: 43 }, //    0.51 × 0.51 m
  roundTable: { w: 184, h: 173 }, //   2.17 × 2.03 m
  benchDesk: { w: 313, h: 65 }, //     3.68 × 0.77 m
  monitor: { w: 57, h: 16 }, //        0.67 × 0.19 m
  softCube: { w: 48, h: 36 }, //       0.56 × 0.42 m
  floorCushion: { w: 57, h: 65 }, //   0.67 × 0.77 m
  sideChair: { w: 75, h: 71 }, //      0.88 × 0.84 m
  // Drawn rather than loaded, so this is the real size, not a model's.
  areaRug: { w: 417, h: 417 }, //      4.90 m square
  garmentRail: { w: 133, h: 145 }, //  1.56 × 1.71 m
  fabricRoll: { w: 26, h: 33 }, //     0.30 × 0.39 m
  fabricStack: { w: 35, h: 35 }, //    0.41 × 0.41 m
  crate: { w: 36, h: 56 }, //          0.42 × 0.66 m
  instrument: { w: 34, h: 7 }, //      0.40 × 0.08 m, 1.25 m tall
  officeRug: { w: 204, h: 234 }, //    1.60 × 1.83 m at 1.5x
  redChair: { w: 75, h: 71 }, //       0.88 × 0.84 m — sideChair, repainted
  tvWall: { w: 225, h: 39 }, //        3.01 × 0.52 m at 0.88x
  gadget: { w: 19, h: 18 }, //         0.22 × 0.21 m
  meetingRug: { w: 313, h: 358 }, //   1.60 × 1.83 m at 2.3x
  poolTable: { w: 118, h: 201 }, //    1.39 × 2.37 m
  arcade: { w: 60, h: 65 }, //         0.83 × 0.90 m at 0.85x
  vending: { w: 55, h: 71 }, //        0.65 × 0.83 m, 1.93 m tall
  gameTable: { w: 118, h: 201 }, //    1.39 × 2.37 m
  doormat: { w: 122, h: 140 }, //      1.60 × 1.83 m at 0.9x
};

export type PresenceStatus = "available" | "focusing" | "away";

export interface PlayerState {
  id: string;
  name: string;
  color: string;

  /**
   * Stable identity across reconnects, derived from the name until Phase 7
   * replaces it with a Google subject id. Connection ids change on every
   * reconnect, so they cannot key a direct message thread.
   */
  identity: string;

  status: PresenceStatus;
  /** Free-text note beside the status — "heads down till 3". */
  note: string;

  /**
   * Profile picture, as a data URL, or absent if none has been set.
   *
   * Stored against the identity rather than the connection, so it survives a
   * reconnect and follows the name: sign in as Karim tomorrow and the picture
   * is already there.
   */
  avatar?: string;
  x: number;
  y: number;
  /** id of the audio zone this player currently occupies, or null for the open floor */
  zoneId: string | null;
  /** Voice activity, detected locally and broadcast. Drives the speaking ring. */
  speaking: boolean;
  muted: boolean;

  /**
   * Whether this player is publishing a face or a screen.
   *
   * Which transceiver carries which is fixed at connection time, so routing
   * needs no signalling. These flags only answer "is it on" — a receiver's
   * transceiver always holds a track, muted and black, even when the sender is
   * publishing nothing.
   */
  cameraOn: boolean;
  screenOn: boolean;

  /**
   * Addressing the whole floor. Overrides distance and sealed rooms in one
   * direction only — everyone hears the broadcaster, the broadcaster still
   * hears the room around them normally.
   */
  broadcasting: boolean;
}

/* ── Wire protocol ───────────────────────────────────────────────── */

/**
 * WebRTC signalling payload. The server relays these between peers verbatim and
 * never inspects them — it is a post box, not a participant in the call.
 */
export type SignalData =
  /**
   * A session description, offer or answer. Carried as one variant rather than
   * two because perfect negotiation treats them uniformly — the receiver
   * decides what to do based on `type` and its own signalling state.
   */
  | { kind: "description"; type: "offer" | "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInitLike };

/** Structural copy of RTCIceCandidateInit so shared/ stays free of DOM lib types. */
export interface RTCIceCandidateInitLike {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/**
 * One Notion database the office can file into.
 *
 * Which columns exist differs per database, so the board asks rather than
 * assumes: offering a priority on a database that has no such column would
 * silently drop it.
 */
export interface NotionSource {
  id: string;
  title: string;
  hasPriority: boolean;
  hasDue: boolean;
}

/** Something new appeared in a database you are watching. */
export interface TaskAlert {
  /** The Notion page id — what makes an alert unique, not its timestamp. */
  id: string;
  database: string;
  /** The database's display name, so the alert reads without a lookup. */
  source: string;
  title: string;
  url: string;
  /** When it was created, epoch ms. */
  at: number;
}

/** A row from the team's Notion task database, flattened for the panel. */
export interface NotionTask {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  /** ISO date, or null when nothing is set. */
  due: string | null;
  url: string;
}

export type ClientMessage =
  /**
   * `key` is the shared passphrase, when the server is running with one. It is
   * checked before anything else: an unguessable URL is not a lock, and this
   * has to survive the link being pasted somewhere it should not be.
   */
  | {
      t: "join";
      name: string;
      /** The shared password, when the browser has no valid device token. */
      key?: string;
      /** A device token issued earlier, used instead of the password. */
      token?: string;
      /** Issue a device token, so this browser is not asked again. */
      remember?: boolean;
    }
  | { t: "move"; x: number; y: number }
  | { t: "presence"; speaking: boolean; muted: boolean }
  | { t: "media"; cameraOn: boolean; screenOn: boolean }
  | { t: "broadcast"; on: boolean }
  | { t: "status"; status: PresenceStatus; note: string }
  /** Open or shut a door. Only permitted from inside the room it belongs to. */
  | { t: "door"; id: string; open: boolean }
  /** Ask to be let in. Only meaningful from outside a shut door. */
  | { t: "knock"; doorId: string }
  | { t: "signal"; to: string; data: SignalData }
  /** Set or clear the profile picture for your identity. Empty string clears. */
  | { t: "avatar"; data: string }
  /** Ask for a task list. Omit `database` for the default one. */
  | { t: "tasks"; database?: string }
  /** File a new task, into `database` or the default one. */
  | { t: "task"; title: string; priority?: string; due?: string; database?: string }
  /** Move a task to another status. `move` is already the player walking. */
  | { t: "taskMove"; page: string; database: string; status: string }
  /** Start or stop watching a database for new tasks. */
  | { t: "watch"; database: string; on: boolean }
  /**
   * Dismiss queued alerts: one page, one database's worth, or all of them.
   *
   * Deliberately explicit. Opening the board used to clear everything, which
   * meant a glance destroyed the only record of what was new.
   */
  | { t: "seen"; page?: string; database?: string };

export type ServerMessage =
  /** The password was wrong or missing. The socket closes straight after. */
  | { t: "denied"; reason: string }
  /**
   * A device token, when one was asked for. The browser stores this instead of
   * the password — so the password is never kept anywhere, and access expires
   * on its own.
   */
  | { t: "device"; token: string; expiresAt: number }
  | { t: "welcome"; selfId: string; floor: Floor; players: PlayerState[]; shutDoors: string[] }
  /**
   * The task list, or why there is not one.
   *
   * `configured` is false when the server has no Notion credentials, which the
   * panel says out loud rather than showing an empty list that looks like "no
   * tasks".
   */
  /** Which databases you are watching. Sent on join and after any change. */
  | { t: "watching"; databases: string[] }
  /** A task appeared in a database you watch, while you were here. */
  | { t: "alert"; alert: TaskAlert }
  /** What you missed while you were away. Sent on join. */
  | { t: "alerts"; alerts: TaskAlert[] }
  | {
      t: "tasks";
      items: NotionTask[];
      sources: NotionSource[];
      database: string;
      /** The open statuses this database defines, in its own order. */
      statuses: string[];
      configured: boolean;
      error?: string;
    }
  /** Door state changed. Sent on change only — doors move rarely. */
  | { t: "doors"; shut: string[] }
  /** Somebody outside wants in. Delivered only to people inside that room. */
  | { t: "knock"; doorId: string; from: string; name: string }
  | { t: "state"; players: PlayerState[] }
  | { t: "joined"; player: PlayerState }
  | { t: "left"; id: string }
  /** Server rejected a move as illegal — snap back to this position. */
  | { t: "correct"; x: number; y: number }
  | { t: "signal"; from: string; data: SignalData };

/* ── Tunables ────────────────────────────────────────────────────── */

/** Server broadcast rate. 15Hz is plenty; remote avatars are interpolated between frames. */
export const TICK_HZ = 15;

/** Client position report rate. Matches the tick so we never send faster than we broadcast. */
export const SEND_HZ = 15;

export const PLAYER_RADIUS = 14;

/**
 * Cap on a profile picture, as data URL characters.
 *
 * The client downscales to 128px before sending, which lands well under this;
 * the cap is here to stop a hand-crafted message putting a megabyte of image
 * into every state broadcast.
 */
export const MAX_AVATAR_CHARS = 90_000;

/**
 * Audible radius on the open floor, in world pixels. Volume falls linearly to
 * zero at this distance. Sized so two conversations can coexist on the studio
 * floor without bleeding into each other — expect to tune it by ear in Phase 2.
 */
export const EARSHOT = 215;

/**
 * Exponential smoothing rate for volume, per second.
 *
 * Volume is never assigned directly — walking produces a continuous change in
 * distance, and stepping the value each frame is audible as a click. High
 * enough to track movement, low enough to stay smooth.
 */
export const GAIN_SMOOTHING = 9;

/** RMS above which the local mic counts as speaking. */
export const SPEAKING_ON = 0.045;

/** RMS below which it stops. The gap is hysteresis, so the ring doesn't flicker. */
export const SPEAKING_OFF = 0.028;

/**
 * Camera capture size.
 *
 * Faces render inside a ~44px circle, so 720p would be thrown away by the
 * scaler. At this size a stream costs roughly 200kbps instead of 600 — which is
 * what keeps mesh viable for video at this team size.
 */
export const CAMERA_WIDTH = 320;
export const CAMERA_HEIGHT = 320;
export const CAMERA_FPS = 24;

/**
 * Screen capture. Low framerate, high resolution — the opposite trade to a
 * face, because what matters is that text stays readable.
 */
export const SCREEN_MAX_WIDTH = 1920;
export const SCREEN_FPS = 8;

/** World pixels per second. Tuned so crossing the open floor takes ~5s. */
export const MOVE_SPEED = 240;

/**
 * Speed tolerance for server validation. Network jitter batches movement into
 * bursts, so a strict check produces false rejections and visible rubber-banding.
 */
export const SPEED_TOLERANCE = 2.5;

/**
 * Avatar colours.
 *
 * Deliberately darker and more saturated than the ground, which is warm and
 * pale — on a linen-and-walnut floor a light avatar disappears. Each is also
 * ringed in near-white when drawn, which does the rest of the separating.
 */
export const AVATAR_COLORS = [
  "#2A4E7A", // indigo
  "#A2412A", // rust
  "#2C6249", // moss
  "#654188", // heather
  "#8A6417", // ochre
  "#1E6270", // teal
  "#8F3341", // madder
  "#3C4A73", // slate blue
];
