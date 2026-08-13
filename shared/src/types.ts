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

/** Decorative floor labels — kitchen, lounge. No behaviour, purely wayfinding. */
export interface Area extends Rect {
  id: string;
  label: string;
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
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  /** id of the audio zone this player currently occupies, or null for the open floor */
  zoneId: string | null;
  /** Voice activity, detected locally and broadcast. Drives the speaking ring. */
  speaking: boolean;
  muted: boolean;
}

/* ── Wire protocol ───────────────────────────────────────────────── */

/**
 * WebRTC signalling payload. The server relays these between peers verbatim and
 * never inspects them — it is a post box, not a participant in the call.
 */
export type SignalData =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
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
  | { t: "signal"; to: string; data: SignalData };

export type ServerMessage =
  | { t: "welcome"; selfId: string; floor: Floor; players: PlayerState[] }
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

/** World pixels per second. Tuned so crossing the open floor takes ~5s. */
export const MOVE_SPEED = 240;

/**
 * Speed tolerance for server validation. Network jitter batches movement into
 * bursts, so a strict check produces false rejections and visible rubber-banding.
 */
export const SPEED_TOLERANCE = 2.5;

export const AVATAR_COLORS = [
  "#1D5D86", // deep indigo
  "#B9622A", // rust
  "#2F6B4F", // moss
  "#8A5B9E", // heather
  "#C08A2E", // ochre
  "#3E7A8C", // teal
  "#A34A55", // madder
  "#5D6B8A", // slate blue
];
