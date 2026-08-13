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

  /**
   * MediaStream ids for this player's published video, or null when off.
   *
   * A peer connection carries several video tracks and the receiver has no
   * inherent way to tell a face from a shared screen. WebRTC signals stream
   * ids in the SDP, so `event.streams[0].id` on the receiving end matches the
   * sender's — publishing the mapping here is what lets a receiver route each
   * incoming track to the right surface.
   */
  cameraStreamId: string | null;
  screenStreamId: string | null;

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
  | { t: "media"; cameraStreamId: string | null; screenStreamId: string | null }
  | { t: "broadcast"; on: boolean }
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
