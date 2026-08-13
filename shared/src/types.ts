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
  name: string;
}

/** A gap in a zone's wall. Openable doors land in Phase 4; for now these are always open. */
export interface Door extends Rect {
  id: string;
  zoneId: string;
}

/** Ground covering. Purely visual, but it is most of what makes a room read. */
export type Material = "oak" | "carpet" | "tile" | "concrete";

/** Named open areas — kitchen, lounge. No behaviour, purely wayfinding. */
export interface Area extends Rect {
  id: string;
  label: string;
  material: Material;
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
export const WALL_HEIGHT = 20;

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
  | "console";

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
  walls: Rect[];
  zones: Zone[];
  doors: Door[];
  areas: Area[];
  furniture: Furniture[];
  signs: Sign[];
  /**
   * Glazed doors drawn over a stretch of outer wall. Decorative — the wall
   * behind stays solid, because there is nowhere to go.
   */
  entrance: Rect;
}

/** Default footprint per kind, in world pixels. */
export const FURNITURE_SIZE: Record<FurnitureKind, { w: number; h: number }> = {
  desk: { w: 116, h: 62 },
  chair: { w: 34, h: 34 },
  sofa: { w: 168, h: 68 },
  armchair: { w: 64, h: 62 },
  meetingTable: { w: 280, h: 118 },
  coffeeTable: { w: 92, h: 56 },
  stool: { w: 32, h: 32 },
  counter: { w: 300, h: 56 },
  plant: { w: 46, h: 46 },
  rug: { w: 250, h: 170 },
  shelf: { w: 150, h: 30 },
  whiteboard: { w: 170, h: 14 },
  lamp: { w: 26, h: 26 },
  bench: { w: 130, h: 40 },
  console: { w: 140, h: 40 },
};

export type PresenceStatus = "available" | "focusing" | "away";

export interface ChatMessage {
  id: number;
  channel: string;
  /** Display name as it was when the message was sent. */
  author: string;
  /** Stable identity, so history survives reconnects and renames. */
  identity: string;
  body: string;
  /** ms since epoch */
  at: number;
}

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

export type ClientMessage =
  | { t: "join"; name: string }
  | { t: "move"; x: number; y: number }
  | { t: "presence"; speaking: boolean; muted: boolean }
  | { t: "media"; cameraOn: boolean; screenOn: boolean }
  | { t: "broadcast"; on: boolean }
  | { t: "status"; status: PresenceStatus; note: string }
  | { t: "chat"; channel: string; body: string }
  /** Page backwards through a channel. Omit `before` for the newest page. */
  | { t: "history"; channel: string; before?: number }
  /** Open or shut a door. Only permitted from inside the room it belongs to. */
  | { t: "door"; id: string; open: boolean }
  /** Ask to be let in. Only meaningful from outside a shut door. */
  | { t: "knock"; doorId: string }
  | { t: "signal"; to: string; data: SignalData };

export type ServerMessage =
  | { t: "welcome"; selfId: string; floor: Floor; players: PlayerState[]; shutDoors: string[] }
  /** Door state changed. Sent on change only — doors move rarely. */
  | { t: "doors"; shut: string[] }
  /** Somebody outside wants in. Delivered only to people inside that room. */
  | { t: "knock"; doorId: string; from: string; name: string }
  | { t: "state"; players: PlayerState[] }
  | { t: "joined"; player: PlayerState }
  | { t: "left"; id: string }
  /** Server rejected a move as illegal — snap back to this position. */
  | { t: "correct"; x: number; y: number }
  | { t: "signal"; from: string; data: SignalData }
  | { t: "chat"; message: ChatMessage }
  | { t: "history"; channel: string; messages: ChatMessage[]; hasMore: boolean };

/* ── Tunables ────────────────────────────────────────────────────── */

/** Server broadcast rate. 15Hz is plenty; remote avatars are interpolated between frames. */
export const TICK_HZ = 15;

/** Client position report rate. Matches the tick so we never send faster than we broadcast. */
export const SEND_HZ = 15;

export const PLAYER_RADIUS = 22;

/**
 * Audible radius on the open floor, in world pixels. Volume falls linearly to
 * zero at this distance. Sized so two conversations can coexist on the studio
 * floor without bleeding into each other — expect to tune it by ear in Phase 2.
 */
export const EARSHOT = 300;

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
