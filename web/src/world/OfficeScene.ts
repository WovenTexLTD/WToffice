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
  resolveMove,
  type Floor,
  type PlayerState,
} from "@wtoffice/shared";

const COLORS = {
  ground: "#E4E9EA",
  roomFill: "#F2F5F5",
  areaFill: "#DCE3E4",
  wall: "#2B3B43",
  label: "#7C929C",
  nameText: "#15222A",
  earshot: "#1D5D86",
} as const;

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.5;

interface Avatar {
  state: PlayerState;
  view: Container;
  body: Graphics;
  /** Rendered position, smoothed toward `target`. */
  cur: { x: number; y: number };
  target: { x: number; y: number };
}

export interface OfficeSceneCallbacks {
  onPositionChange(x: number, y: number): void;
  /** Fires when the local player enters or leaves a sealed room. */
  onZoneChange(zoneId: string | null): void;
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

  setFloor(floor: Floor, selfId: string, players: PlayerState[]): void {
    this.floor = floor;
    this.selfId = selfId;

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

    // Doorways: a dashed threshold so the opening reads as a door, not a gap.
    const doors = new Graphics();
    for (const d of floor.doors) {
      doors.rect(d.x, d.y, d.w, d.h).fill({ color: COLORS.wall, alpha: 0.18 });
    }
    layer.addChild(doors);

    return layer;
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
      cur: { x: state.x, y: state.y },
      target: { x: state.x, y: state.y },
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
    if (!this.app || !this.floor) return;
    const rect = this.app.canvas.getBoundingClientRect();
    this.moveTarget = {
      x: (e.clientX - rect.left - this.world.x) / this.zoom,
      y: (e.clientY - rect.top - this.world.y) / this.zoom,
    };
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

    this.moveLocal(step, floor);
    this.smoothRemotes(step);
    this.updateCamera(app, floor);
    this.reportPosition(step);
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

    // Same resolver the server uses, so predictions agree.
    this.local = resolveMove(this.local, next, PLAYER_RADIUS, floor.walls, floor);

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

    const self = this.avatars.get(this.selfId);
    const zoneId = self?.state.zoneId ?? null;
    if (zoneId !== this.lastZoneId) {
      this.lastZoneId = zoneId;
      this.callbacks.onZoneChange(zoneId);
    }
  }
}
