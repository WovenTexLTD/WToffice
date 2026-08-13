/**
 * The 2D office world.
 *
 * Owns the PixiJS application, the render loop, input, and local movement
 * simulation. The React layer only mounts and unmounts it.
 *
 * Movement model:
 *  - The local player is simulated here every frame, so it responds instantly.
 *  - Position is reported to the server at SEND_HZ; the server may correct it.
 *  - Remote players arrive at TICK_HZ and are smoothed toward their last known
 *    position, which is what stops them stuttering between packets.
 */

import { Application, Container, Graphics, Text } from "pixi.js";
import {
  EARSHOT,
  MOVE_SPEED,
  PLAYER_RADIUS,
  SEND_HZ,
  audioGain,
  doorAt,
  resolveMove,
  videoVisible,
  wallsWithShutDoors,
  zoneAt,
  type Floor,
  type PlayerState,
  type Rect,
} from "@wtoffice/shared";

const COLORS = {
  ground: "#E4E9EA",
  roomFill: "#F2F5F5",
  areaFill: "#DCE3E4",
  wall: "#2B3B43",
  label: "#7C929C",
  nameText: "#15222A",
  earshot: "#1D5D86",
  doorHandle: "#C08A2E",
} as const;

const STATUS_COLOR = {
  available: "#2F6B4F",
  focusing: "#C08A2E",
  away: "#8C9EA6",
} as const;

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.5;

interface Avatar {
  state: PlayerState;
  view: Container;
  body: Graphics;
  /** Ring that appears while this person is talking. */
  speakingRing: Graphics;
  /** Small presence dot. Redrawn only when the status changes. */
  statusDot: Graphics;
  lastStatus: string | null;
  nameLabel: Text;
  /** Rendered position, smoothed toward `target`. */
  cur: { x: number; y: number };
  target: { x: number; y: number };
  /** Last gain reported to the media engine, to avoid redundant updates. */
  lastGain: number;
  /** Last video-visibility decisions, likewise. */
  lastSeeVideo: boolean | null;
  lastSendVideo: boolean | null;
}

export interface OfficeSceneCallbacks {
  onPositionChange(x: number, y: number): void;
  /** Fires when the local player enters or leaves a sealed room. */
  onZoneChange(zoneId: string | null): void;
  /** How loudly this peer should be heard, 0–1, from the proximity rule. */
  onGain(peerId: string, gain: number): void;
  /** Whether we can see this peer's video — drives what we render. */
  onSeeVideo(peerId: string, visible: boolean): void;
  /**
   * Whether this peer can see *us* — the reverse direction, which is what
   * decides if sending them video is worth the bytes. Separate because
   * broadcast makes the two directions differ.
   */
  onSendVideo(peerId: string, enabled: boolean): void;
  onDoorToggle(doorId: string, open: boolean): void;
  onKnock(doorId: string): void;
}

/**
 * Anything that draws on top of an avatar in screen space — currently the video
 * circles. Kept as an interface so the scene owns no opinion about the DOM.
 */
export interface AvatarSurface {
  beginFrame(): void;
  place(id: string, screenX: number, screenY: number, diameter: number): void;
  endFrame(): void;
}

export class OfficeScene {
  private app: Application | null = null;
  private world = new Container();
  private avatarLayer = new Container();
  private avatars = new Map<string, Avatar>();

  private floor: Floor | null = null;
  private selfId = "";
  private local = { x: 0, y: 0 };
  private moveTarget: { x: number; y: number } | null = null;
  private zoom = 1;
  private lastZoneId: string | null = null;
  private elapsed = 0;
  private surface: AvatarSurface | null = null;

  private shutDoors = new Set<string>();
  /** Collision geometry including shut doors. Recomputed only when doors move. */
  private walls: Rect[] = [];
  private doorGfx: Graphics | null = null;
  private selfBroadcasting = false;

  private keys = new Set<string>();
  private sendAccumulator = 0;
  private lastSent = { x: -1, y: -1 };
  private destroyed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: OfficeSceneCallbacks,
  ) {}

  /* ── Lifecycle ─────────────────────────────────────────────────── */

  async init(): Promise<void> {
    const app = new Application();
    await app.init({
      background: COLORS.ground,
      resizeTo: this.container,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // An await elapsed; the component may already have unmounted.
    if (this.destroyed) {
      app.destroy(true, { children: true });
      return;
    }

    this.app = app;
    this.container.appendChild(app.canvas);
    app.stage.addChild(this.world);

    this.bindInput();
    app.ticker.add(() => this.tick(app.ticker.deltaMS / 1000));
  }

  destroy(): void {
    this.destroyed = true;
    this.unbindInput();
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.avatars.clear();
  }

  /* ── World construction ────────────────────────────────────────── */

  setFloor(floor: Floor, selfId: string, players: PlayerState[], shutDoors: string[] = []): void {
    this.floor = floor;
    this.selfId = selfId;
    this.shutDoors = new Set(shutDoors);
    this.walls = wallsWithShutDoors(floor, this.shutDoors);

    const self = players.find((p) => p.id === selfId);
    this.local = { x: self?.x ?? floor.spawn.x, y: self?.y ?? floor.spawn.y };

    this.world.removeChildren();
    this.avatars.clear();

    this.world.addChild(this.drawFloor(floor));
    this.world.addChild(this.avatarLayer);
    this.avatarLayer.removeChildren();

    for (const p of players) this.addAvatar(p);
  }

  private drawFloor(floor: Floor): Container {
    const layer = new Container();

    const ground = new Graphics();
    ground.rect(0, 0, floor.width, floor.height).fill(COLORS.ground);
    layer.addChild(ground);

    // Named open areas — wayfinding only, no behaviour.
    for (const area of floor.areas) {
      const g = new Graphics();
      g.roundRect(area.x, area.y, area.w, area.h, 10).fill({ color: COLORS.areaFill, alpha: 0.75 });
      layer.addChild(g);

      const label = new Text({
        text: area.label.toUpperCase(),
        style: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          letterSpacing: 2.5,
          fill: COLORS.label,
        },
      });
      label.anchor.set(0.5);
      label.position.set(area.x + area.w / 2, area.y + area.h / 2);
      layer.addChild(label);
    }

    // Sealed rooms, drawn lighter so they read as separate spaces.
    for (const zone of floor.zones) {
      const g = new Graphics();
      g.rect(zone.x, zone.y, zone.w, zone.h).fill(COLORS.roomFill);
      layer.addChild(g);

      const label = new Text({
        text: zone.name.toUpperCase(),
        style: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          letterSpacing: 2.5,
          fill: COLORS.label,
        },
      });
      label.anchor.set(0.5, 0);
      label.position.set(zone.x + zone.w / 2, zone.y + 18);
      layer.addChild(label);
    }

    const walls = new Graphics();
    for (const w of floor.walls) walls.rect(w.x, w.y, w.w, w.h);
    walls.fill(COLORS.wall);
    layer.addChild(walls);

    // Redrawn whenever a door opens or shuts, so it lives on its own layer.
    this.doorGfx = new Graphics();
    layer.addChild(this.doorGfx);
    this.redrawDoors();

    return layer;
  }

  /** Apply an authoritative door update from the server. */
  setDoors(shut: string[]): void {
    this.shutDoors = new Set(shut);
    if (this.floor) this.walls = wallsWithShutDoors(this.floor, this.shutDoors);
    this.redrawDoors();
  }

  isDoorShut(doorId: string): boolean {
    return this.shutDoors.has(doorId);
  }

  private redrawDoors(): void {
    const g = this.doorGfx;
    const floor = this.floor;
    if (!g || !floor) return;

    g.clear();

    for (const door of floor.doors) {
      if (this.shutDoors.has(door.id)) {
        // Shut: reads as wall, with a handle so it's obviously a door.
        g.rect(door.x, door.y, door.w, door.h).fill(COLORS.wall);
        const cx = door.x + door.w / 2;
        const cy = door.y + door.h / 2;
        g.circle(cx, cy, 3.5).fill(COLORS.doorHandle);
      } else {
        // Open: a faint threshold across the gap.
        g.rect(door.x, door.y, door.w, door.h).fill({ color: COLORS.wall, alpha: 0.16 });
      }
    }
  }

  /* ── Avatars ───────────────────────────────────────────────────── */

  private addAvatar(state: PlayerState): void {
    const view = new Container();
    const isSelf = state.id === this.selfId;

    // Earshot ring, drawn only for the local player — this is the audio range
    // that Phase 2 will make audible, and seeing it teaches the mechanic.
    if (isSelf) {
      const ring = new Graphics();
      ring.circle(0, 0, EARSHOT).fill({ color: COLORS.earshot, alpha: 0.05 });
      ring.circle(0, 0, EARSHOT).stroke({ width: 1.5, color: COLORS.earshot, alpha: 0.28 });
      view.addChild(ring);
    }

    // Sits behind the body so it reads as a halo rather than an outline.
    const speakingRing = new Graphics();
    speakingRing.circle(0, 0, PLAYER_RADIUS + 7).fill({ color: state.color, alpha: 0.35 });
    speakingRing.visible = false;
    view.addChild(speakingRing);

    const body = new Graphics();
    body.circle(0, 0, PLAYER_RADIUS).fill(state.color);
    body.circle(0, 0, PLAYER_RADIUS).stroke({ width: 3, color: "#F8FAFA" });
    view.addChild(body);

    const initials = new Text({
      text: state.name.slice(0, 2).toUpperCase(),
      style: {
        fontFamily: "-apple-system, system-ui, sans-serif",
        fontSize: 15,
        fontWeight: "600",
        fill: "#FFFFFF",
      },
    });
    initials.anchor.set(0.5);
    view.addChild(initials);

    // Sits on the rim, bottom-right, like a presence badge.
    const statusDot = new Graphics();
    statusDot.position.set(PLAYER_RADIUS * 0.72, PLAYER_RADIUS * 0.72);
    view.addChild(statusDot);

    const name = new Text({
      text: isSelf ? `${state.name} (you)` : state.name,
      style: {
        fontFamily: "-apple-system, system-ui, sans-serif",
        fontSize: 13,
        fontWeight: "500",
        fill: COLORS.nameText,
      },
    });
    name.anchor.set(0.5, 0);
    name.position.set(0, PLAYER_RADIUS + 8);
    view.addChild(name);

    view.position.set(state.x, state.y);
    this.avatarLayer.addChild(view);

    this.avatars.set(state.id, {
      state,
      view,
      body,
      speakingRing,
      statusDot,
      lastStatus: null,
      nameLabel: name,
      cur: { x: state.x, y: state.y },
      target: { x: state.x, y: state.y },
      lastGain: -1,
      lastSeeVideo: null,
      lastSendVideo: null,
    });
  }

  addPlayer(state: PlayerState): void {
    if (this.avatars.has(state.id)) return;
    this.addAvatar(state);
  }

  removePlayer(id: string): void {
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    avatar.view.destroy({ children: true });
    this.avatars.delete(id);
  }

  /** Apply a server state broadcast. The local player's own position is ignored. */
  applyState(players: PlayerState[]): void {
    for (const p of players) {
      const avatar = this.avatars.get(p.id);
      if (!avatar) {
        this.addAvatar(p);
        continue;
      }
      avatar.state = p;
      if (p.id !== this.selfId) {
        avatar.target.x = p.x;
        avatar.target.y = p.y;
      }
    }
  }

  /** Server rejected a move — snap back. */
  correctPosition(x: number, y: number): void {
    this.local.x = x;
    this.local.y = y;
    this.moveTarget = null;
  }

  /* ── Input ─────────────────────────────────────────────────────── */

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      this.keys.add(k);
      this.moveTarget = null; // Keyboard overrides click-to-move.
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = () => this.keys.clear();

  private onPointerDown = (e: PointerEvent) => {
    const floor = this.floor;
    if (!this.app || !floor) return;

    const rect = this.app.canvas.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - this.world.x) / this.zoom;
    const worldY = (e.clientY - rect.top - this.world.y) / this.zoom;

    const door = doorAt(worldX, worldY, floor.doors);
    if (door) {
      const myZone = zoneAt(this.local.x, this.local.y, floor.zones);
      const shut = this.shutDoors.has(door.id);

      if (myZone === door.zoneId) {
        // Inside: the door is yours to work.
        this.callbacks.onDoorToggle(door.id, shut);
        return;
      }
      if (shut) {
        // Outside a shut door: ask, don't barge.
        this.callbacks.onKnock(door.id);
        return;
      }
      // Outside an open door: just walk through it.
    }

    this.moveTarget = { x: worldX, y: worldY };
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const next = this.zoom * (e.deltaY > 0 ? 0.94 : 1.06);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  };

  private bindInput(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.app?.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.app?.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private unbindInput(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.app?.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.app?.canvas.removeEventListener("wheel", this.onWheel);
  }

  /* ── Frame ─────────────────────────────────────────────────────── */

  private tick(dt: number): void {
    const app = this.app;
    const floor = this.floor;
    if (!app || !floor) return;

    // Large dt means the tab was backgrounded — don't teleport on return.
    const step = Math.min(dt, 0.05);
    this.elapsed += step;

    this.moveLocal(step, floor);
    this.smoothRemotes(step);
    this.updateAudio(floor);
    this.updateSpeakingRings();
    this.updateCamera(app, floor);
    this.placeSurface(app);
    this.reportPosition(step);
  }

  /** Attach the video overlay. Optional — the scene runs fine without one. */
  setSurface(surface: AvatarSurface | null): void {
    this.surface = surface;
  }

  /**
   * Project every avatar into screen space for the video overlay. Runs after
   * the camera so the two can never disagree by a frame, which would show as
   * video circles lagging behind their avatars.
   */
  private placeSurface(app: Application): void {
    const surface = this.surface;
    if (!surface) return;

    surface.beginFrame();

    const diameter = PLAYER_RADIUS * 2 * this.zoom;
    const margin = diameter;

    for (const [id, avatar] of this.avatars) {
      const sx = this.world.x + avatar.cur.x * this.zoom;
      const sy = this.world.y + avatar.cur.y * this.zoom;

      // Skip offscreen avatars; endFrame hides whatever wasn't placed.
      if (sx < -margin || sy < -margin || sx > app.screen.width + margin || sy > app.screen.height + margin) {
        continue;
      }
      surface.place(id, sx, sy, diameter);
    }

    surface.endFrame();
  }

  /**
   * Apply the proximity rule to every peer, every frame.
   *
   * The listener's zone is computed from the local position rather than read
   * from server state, so crossing a threshold takes effect immediately instead
   * of after a round trip — you should hear the room seal as you step through
   * the door, not a beat later.
   */
  private updateAudio(floor: Floor): void {
    const selfZone = zoneAt(this.local.x, this.local.y, floor.zones);
    const me = {
      x: this.local.x,
      y: this.local.y,
      zoneId: selfZone,
      broadcasting: this.selfBroadcasting,
    };

    if (selfZone !== this.lastZoneId) {
      this.lastZoneId = selfZone;
      this.callbacks.onZoneChange(selfZone);
    }

    for (const [id, avatar] of this.avatars) {
      if (id === this.selfId) continue;

      // Smoothed render position, so what you hear matches what you see.
      const them = {
        x: avatar.cur.x,
        y: avatar.cur.y,
        zoneId: avatar.state.zoneId,
        broadcasting: avatar.state.broadcasting,
      };

      const hear = audioGain(me, them, EARSHOT);
      if (Math.abs(hear - avatar.lastGain) > 0.004) {
        avatar.lastGain = hear;
        this.callbacks.onGain(id, hear);
      }

      // Video is gated by zone rather than distance — see videoVisible. Both
      // directions are evaluated because broadcast makes them differ.
      const iSeeThem = videoVisible(me, them);
      if (iSeeThem !== avatar.lastSeeVideo) {
        avatar.lastSeeVideo = iSeeThem;
        this.callbacks.onSeeVideo(id, iSeeThem);
      }

      const theySeeMe = videoVisible(them, me);
      if (theySeeMe !== avatar.lastSendVideo) {
        avatar.lastSendVideo = theySeeMe;
        this.callbacks.onSendVideo(id, theySeeMe);
      }

      // Fade the name with audibility, so you can see who is in earshot.
      avatar.nameLabel.alpha = 0.3 + hear * 0.7;
    }
  }

  /** Local broadcast state, applied without waiting for the server round trip. */
  setSelfBroadcast(on: boolean): void {
    this.selfBroadcasting = on;
    const self = this.avatars.get(this.selfId);
    if (self) self.state.broadcasting = on;
  }

  private updateSpeakingRings(): void {
    const pulse = 0.3 + Math.sin(this.elapsed * 7) * 0.12;

    for (const avatar of this.avatars.values()) {
      const active = avatar.state.speaking && !avatar.state.muted;
      avatar.speakingRing.visible = active;
      if (active) avatar.speakingRing.alpha = pulse;

      // Redraw the badge only when the status actually changes.
      const status = avatar.state.status;
      if (status !== avatar.lastStatus) {
        avatar.lastStatus = status;
        const fill = STATUS_COLOR[status] ?? STATUS_COLOR.away;
        avatar.statusDot.clear();
        avatar.statusDot.circle(0, 0, 5.5).fill(fill);
        avatar.statusDot.circle(0, 0, 5.5).stroke({ width: 2.5, color: "#F8FAFA" });
      }
    }
  }

  /**
   * Walk over to someone.
   *
   * Aims beside them rather than at them, so you end up standing alongside
   * instead of shoving into their collision circle and stopping short.
   */
  walkToPlayer(playerId: string): void {
    const target = this.avatars.get(playerId);
    if (!target || playerId === this.selfId) return;

    const fromLeft = this.local.x <= target.cur.x;
    this.moveTarget = {
      x: target.cur.x + (fromLeft ? -1 : 1) * PLAYER_RADIUS * 2.4,
      y: target.cur.y,
    };
  }

  /** Local voice activity, applied without waiting for the server round trip. */
  setSelfVoice(speaking: boolean, muted: boolean): void {
    const self = this.avatars.get(this.selfId);
    if (!self) return;
    self.state.speaking = speaking;
    self.state.muted = muted;
  }

  private moveLocal(dt: number, floor: Floor): void {
    let dx = 0;
    let dy = 0;

    if (this.keys.has("a") || this.keys.has("arrowleft")) dx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx += 1;
    if (this.keys.has("w") || this.keys.has("arrowup")) dy -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dy += 1;

    if (dx === 0 && dy === 0 && this.moveTarget) {
      const tx = this.moveTarget.x - this.local.x;
      const ty = this.moveTarget.y - this.local.y;
      const dist = Math.hypot(tx, ty);
      if (dist < 5) {
        this.moveTarget = null;
      } else {
        dx = tx / dist;
        dy = ty / dist;
      }
    }

    if (dx === 0 && dy === 0) return;

    // Normalise so diagonal movement isn't faster than orthogonal.
    const len = Math.hypot(dx, dy) || 1;
    const next = {
      x: this.local.x + (dx / len) * MOVE_SPEED * dt,
      y: this.local.y + (dy / len) * MOVE_SPEED * dt,
    };

    // Same resolver and same geometry the server uses, so predictions agree.
    this.local = resolveMove(this.local, next, PLAYER_RADIUS, this.walls, floor);

    const self = this.avatars.get(this.selfId);
    if (self) {
      self.cur = { ...this.local };
      self.view.position.set(this.local.x, this.local.y);
    }
  }

  private smoothRemotes(dt: number): void {
    // Exponential smoothing, frame-rate independent. Fast enough to feel
    // responsive, slow enough to hide the 15Hz packet boundary.
    const k = 1 - Math.exp(-14 * dt);

    for (const [id, avatar] of this.avatars) {
      if (id === this.selfId) continue;
      avatar.cur.x += (avatar.target.x - avatar.cur.x) * k;
      avatar.cur.y += (avatar.target.y - avatar.cur.y) * k;
      avatar.view.position.set(avatar.cur.x, avatar.cur.y);
    }
  }

  private updateCamera(app: Application, floor: Floor): void {
    this.world.scale.set(this.zoom);

    const viewW = app.screen.width;
    const viewH = app.screen.height;
    const worldW = floor.width * this.zoom;
    const worldH = floor.height * this.zoom;

    // Centre on the player, but never scroll past the world edge. If the world
    // is smaller than the viewport on an axis, centre it instead.
    let x = viewW / 2 - this.local.x * this.zoom;
    let y = viewH / 2 - this.local.y * this.zoom;

    x = worldW <= viewW ? (viewW - worldW) / 2 : Math.min(0, Math.max(viewW - worldW, x));
    y = worldH <= viewH ? (viewH - worldH) / 2 : Math.min(0, Math.max(viewH - worldH, y));

    this.world.position.set(Math.round(x), Math.round(y));
  }

  private reportPosition(dt: number): void {
    this.sendAccumulator += dt;
    if (this.sendAccumulator < 1 / SEND_HZ) return;
    this.sendAccumulator = 0;

    // Only send when we actually moved — an idle office costs zero traffic.
    if (Math.abs(this.local.x - this.lastSent.x) < 0.5 && Math.abs(this.local.y - this.lastSent.y) < 0.5) {
      return;
    }
    this.lastSent = { ...this.local };
    this.callbacks.onPositionChange(this.local.x, this.local.y);
  }
}
