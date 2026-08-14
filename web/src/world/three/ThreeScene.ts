/**
 * The office, in three dimensions.
 *
 * A drop-in replacement for the PixiJS scene: same constructor, same callbacks,
 * same methods. Everything outside this file — collision, proximity, netcode,
 * media, chat — is untouched, because the world was always a flat plan and only
 * the renderer ever cared how it looked.
 *
 * Coordinates: the plan's (x, y) maps to Three's (x, z), with Y as height. One
 * world unit is roughly 1.2cm, which is what sets furniture proportions.
 *
 * Faces stay as DOM elements above the canvas rather than textures in the scene.
 * Video kept in the DOM is sharper, costs no per-frame texture upload, and reuses
 * the overlay that already exists — the scene just projects each head to screen.
 */

import * as THREE from "three";
import {
  EARSHOT,
  MOVE_SPEED,
  PLAYER_RADIUS,
  SEND_HZ,
  audioGain,
  collisionRects,
  doorAt,
  resolveMove,
  videoVisible,
  zoneAt,
  type Floor,
  type PlayerState,
  type Rect,
  type Wall,
} from "@wtoffice/shared";

import { buildFurniture } from "./models";
import { doorLeaf, groundTiles, modelFor, tileFloor } from "./loader";
import { floorMaterial, labelSprite } from "./textures";

/* ── Scale ────────────────────────────────────────────────────────── */

const WALL_H = 165;

/** A door leaf stops just short of the ceiling line, as a real one does. */
const DOOR_H = WALL_H - 12;

/**
 * How high a video tile floats above the floor.
 *
 * Low, because the camera is nearly overhead: a tile lifted to head height
 * would project well away from the feet it belongs to and slide around as the
 * camera moves.
 */
const TILE_Y = 34;

const MIN_DISTANCE = 620;
const MAX_DISTANCE = 1900;
const DEFAULT_DISTANCE = 1150;

/**
 * Camera direction: almost straight down, tipped back about 20°.
 *
 * The realism comes from the objects and the lighting, not from the angle. Tilt
 * far enough to see the fronts of things and the room stops reading as a plan
 * and starts hiding half of itself behind the furniture.
 */
const VIEW_DIR = new THREE.Vector3(0, 0.94, 0.34).normalize();

const STATUS_COLOR: Record<string, number> = {
  available: 0x3f8a63,
  focusing: 0xc08a2e,
  away: 0x8c9ea6,
};

interface Avatar {
  state: PlayerState;
  group: THREE.Group;
  /** Contact shadow, so a tile reads as standing somewhere rather than floating. */
  shadow: THREE.Mesh;
  ring: THREE.Mesh;
  earshot: THREE.Mesh | null;
  cur: { x: number; y: number };
  target: { x: number; y: number };
  lastGain: number;
  lastSeeVideo: boolean | null;
  lastSendVideo: boolean | null;
  lastStatus: string | null;
}

export interface OfficeSceneCallbacks {
  onPositionChange(x: number, y: number): void;
  onZoneChange(zoneId: string | null): void;
  onGain(peerId: string, gain: number): void;
  onSeeVideo(peerId: string, visible: boolean): void;
  onSendVideo(peerId: string, enabled: boolean): void;
  onDoorToggle(doorId: string, open: boolean): void;
  onKnock(doorId: string): void;
}

export interface AvatarSurface {
  beginFrame(): void;
  place(id: string, screenX: number, screenY: number, diameter: number): void;
  endFrame(): void;
}

export class ThreeScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 10, 4000);
  private raycaster = new THREE.Raycaster();

  private worldGroup = new THREE.Group();
  private avatarGroup = new THREE.Group();
  private doorMeshes: THREE.Object3D[] = [];
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private avatars = new Map<string, Avatar>();
  private floor: Floor | null = null;
  private selfId = "";
  private local = { x: 0, y: 0 };
  private moveTarget: { x: number; y: number } | null = null;

  private distance = DEFAULT_DISTANCE;
  private lastZoneId: string | null = null;
  private elapsed = 0;
  private surface: AvatarSurface | null = null;
  private selfBroadcasting = false;

  /**
   * Aims the camera somewhere other than at the player.
   *
   * Only used by the screenshot tool, so the floor can be photographed from
   * anywhere without walking there first.
   */
  private cameraOverride: { x: number; y: number; distance: number } | null = null;

  private shutDoors = new Set<string>();
  private walls: Rect[] = [];

  private keys = new Set<string>();
  private sendAccumulator = 0;
  private lastSent = { x: -1, y: -1 };
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;
  private frameId: number | null = null;
  private lastFrameAt = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: OfficeSceneCallbacks,
  ) {}

  /* ── Lifecycle ─────────────────────────────────────────────────── */

  async init(): Promise<void> {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic tone mapping is most of why a rendered room looks photographic
    // rather than like flat-shaded plastic.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    if (this.destroyed) {
      renderer.dispose();
      return;
    }

    this.renderer = renderer;
    this.container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    this.scene.background = new THREE.Color("#0F1416");
    // Far enough out to sit beyond the far corner of the floor. Pulled in, it
    // greys out the rooms at the other end of the office.
    this.scene.fog = new THREE.Fog("#0F1416", 3000, 5200);
    this.scene.add(this.worldGroup);
    this.scene.add(this.avatarGroup);

    await this.setupEnvironment(renderer);
    this.setupLights();
    this.bindInput();
    this.observeResize();
    this.startLoop();
  }

  /**
   * An image-based environment, which gives every material something to
   * reflect. Without it, PBR surfaces have nothing but the direct lights to
   * work with and read as matte paint.
   */
  private async setupEnvironment(renderer: THREE.WebGLRenderer): Promise<void> {
    const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
    if (this.destroyed) return;

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();
  }

  private setupLights(): void {
    // Carries the interior. A single hard sun with little fill gives an office
    // the shadows of a car park at five o'clock.
    this.scene.add(new THREE.HemisphereLight(0xe6edf4, 0x7a6a55, 1.25));

    // High and soft. At a low angle every object throws a long hard shadow
    // across the floor, which reads as outdoors — interiors are lit from much
    // closer to overhead, and the shadows are short and diffuse.
    const sun = new THREE.DirectionalLight(0xfff4e4, 1.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 2;
    sun.shadow.radius = 5;

    // Sized to the whole floor and aimed at its centre. A shadow camera that
    // covers only part of the plan leaves the far rooms unshadowed, which reads
    // as those rooms being unlit.
    const cam = sun.shadow.camera;
    cam.left = -1450;
    cam.right = 1450;
    cam.top = 1000;
    cam.bottom = -1000;
    cam.near = 200;
    cam.far = 3600;
    cam.updateProjectionMatrix();

    // About 70° above the horizon, from the glazed north-west corner.
    sun.position.set(600, 2800, 300);
    sun.target.position.set(1300, 0, 850);
    this.scene.add(sun);
    this.scene.add(sun.target);

    // A cool bounce from the opposite side, so shadows are not dead black.
    const fill = new THREE.DirectionalLight(0xd6e4f0, 0.62);
    fill.position.set(2200, 900, 1900);
    this.scene.add(fill);
  }

  private observeResize(): void {
    const apply = () => {
      const renderer = this.renderer;
      if (!renderer) return;
      const w = this.container.clientWidth || 1;
      const h = this.container.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    apply();
    this.resizeObserver = new ResizeObserver(apply);
    this.resizeObserver.observe(this.container);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;

    this.unbindInput();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    });

    this.renderer?.domElement.remove();
    this.renderer?.dispose();
    this.renderer = null;
    this.avatars.clear();
  }

  /* ── World ─────────────────────────────────────────────────────── */

  setFloor(floor: Floor, selfId: string, players: PlayerState[], shutDoors: string[] = []): void {
    this.floor = floor;
    this.selfId = selfId;
    this.shutDoors = new Set(shutDoors);
    this.walls = collisionRects(floor, this.shutDoors);

    const self = players.find((p) => p.id === selfId);
    this.local = { x: self?.x ?? floor.spawn.x, y: self?.y ?? floor.spawn.y };

    this.worldGroup.clear();
    this.avatarGroup.clear();
    this.avatars.clear();
    this.doorMeshes = [];

    this.buildGround(floor);
    this.buildWalls(floor);
    this.buildDoors(floor);
    this.buildSigns(floor);

    // Primitives go in immediately so the room is complete on the first frame;
    // bought models replace them as they arrive. A missing or broken asset
    // therefore costs nothing but its own detail.
    for (const item of floor.furniture) {
      const placeholder = buildFurniture(item);
      this.worldGroup.add(placeholder);

      void modelFor(item).then((model) => {
        if (this.destroyed || !model) return;
        // The floor may have been rebuilt while this was in flight.
        if (placeholder.parent !== this.worldGroup) return;

        model.position.copy(placeholder.position);
        model.rotation.y = placeholder.rotation.y;
        this.worldGroup.add(model);
        this.worldGroup.remove(placeholder);
      });
    }

    for (const p of players) this.addAvatar(p);
  }

  private buildGround(floor: Floor): void {
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(floor.width, floor.height),
      floorMaterial(floor.groundMaterial, floor.width, floor.height),
    );
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(floor.width / 2, 0, floor.height / 2);
    slab.receiveShadow = true;
    this.worldGroup.add(slab);

    // A model ground goes on top when one is named. The textured slab under it
    // means there is never a hole, and it is what shows otherwise.
    if (floor.groundModel) {
      void groundTiles(floor.width, floor.height).then((tiles) => {
        if (!tiles || this.floor !== floor) return;
        tiles.position.y = 0.2;
        this.worldGroup.add(tiles);
      });
    }

    const patch = (r: Rect, material: THREE.Material, lift: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(r.x + r.w / 2, lift, r.y + r.h / 2);
      mesh.receiveShadow = true;
      this.worldGroup.add(mesh);
    };

    for (const area of floor.areas) {
      // No colour multiplier. Tinting a texture that already carries its colour
      // multiplies the two together and darkens everything — the colour belongs
      // in one place, and that place is the generator in textures.ts.
      // The procedural covering goes down either way: it is what shows while a
      // model tile loads, and what remains if one is not named or fails.
      patch(area, floorMaterial(area.material, area.w, area.h), 0.4);

      if (!area.model) continue;
      void tileFloor(`/models/${area.model}.glb`, area).then((tiles) => {
        if (!tiles || this.floor !== floor) return;
        tiles.position.y = 0.6;
        this.worldGroup.add(tiles);
      });
    }

    for (const zone of floor.zones) {
      patch(zone, floorMaterial(zone.material, zone.w, zone.h), 0.4);
    }
  }

  private buildWalls(floor: Floor): void {
    const material = new THREE.MeshStandardMaterial({ color: "#EFEAE1", roughness: 0.94 });
    const skirting = new THREE.MeshStandardMaterial({ color: "#D8D0C4", roughness: 0.8 });

    for (const w of floor.walls) {
      if (w.glass) {
        this.buildGlazedWall(w);
        continue;
      }

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, WALL_H, w.h), material);
      mesh.position.set(w.x + w.w / 2, WALL_H / 2, w.y + w.h / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.worldGroup.add(mesh);

      // A skirting board reads as "built" rather than "extruded rectangle".
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(w.w + 3, 14, w.h + 3),
        skirting,
      );
      skirt.position.set(w.x + w.w / 2, 7, w.y + w.h / 2);
      skirt.receiveShadow = true;
      this.worldGroup.add(skirt);
    }

    // Glazed entrance, set into the wall it replaces.
    const e = floor.entrance;
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(e.w + 2, WALL_H * 0.82, e.h - 8),
      new THREE.MeshPhysicalMaterial({
        color: "#DCE9EA",
        roughness: 0.06,
        metalness: 0,
        transmission: 0.85,
        thickness: 6,
        transparent: true,
        opacity: 0.55,
      }),
    );
    glass.position.set(e.x + e.w / 2, (WALL_H * 0.82) / 2 + 6, e.y + e.h / 2);
    this.worldGroup.add(glass);

    // Daylight spilling in, which is what makes the room feel like it has an
    // outside rather than a sealed box. A point light rather than a RectAreaLight,
    // which needs a uniforms library initialised or it silently lights nothing.
    const daylight = new THREE.PointLight(0xdcecff, 2.4, 900, 1.4);
    daylight.position.set(e.x + e.w + 70, WALL_H * 0.5, e.y + e.h / 2);
    this.worldGroup.add(daylight);
  }

  /**
   * A glazed partition: panel, floor and head rails, and mullions.
   *
   * The framing is what sells it. A bare transparent box reads as a rendering
   * mistake; rails and posts at a believable spacing read as architecture.
   *
   * Deliberately cheap glass — tinted and transparent, with no `transmission`.
   * Real refraction costs an extra render pass per frame, and at this camera
   * distance, through a 2cm pane, it buys nothing you can see.
   *
   * The panel casts no shadow, or every glass room would sit in a dark
   * rectangle. The framing still does, which keeps them grounded.
   */
  private buildGlazedWall(w: Wall): void {
    const glass = new THREE.MeshPhysicalMaterial({
      color: "#CBDEE0",
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
    });
    const frame = new THREE.MeshStandardMaterial({ color: "#454B50", roughness: 0.4, metalness: 0.6 });

    const cx = w.x + w.w / 2;
    const cz = w.y + w.h / 2;
    const alongX = w.w >= w.h;
    const span = alongX ? w.w : w.h;

    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? w.w : w.w * 0.4, WALL_H - 26, alongX ? w.h * 0.4 : w.h),
      glass,
    );
    panel.position.set(cx, (WALL_H - 26) / 2 + 13, cz);
    this.worldGroup.add(panel);

    const rail = (y: number, height: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, height, w.h), frame);
      mesh.position.set(cx, y, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.worldGroup.add(mesh);
    };
    rail(6.5, 13);
    rail(WALL_H - 6.5, 13);

    // A post roughly every 1.2m, which is how real glazing is divided.
    const posts = Math.max(1, Math.round(span / 102));
    for (let i = 1; i < posts; i++) {
      const t = i / posts;
      const post = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 7 : w.w, WALL_H - 26, alongX ? w.h : 7), frame);
      post.position.set(
        alongX ? w.x + t * w.w : cx,
        (WALL_H - 26) / 2 + 13,
        alongX ? cz : w.y + t * w.h,
      );
      post.castShadow = true;
      this.worldGroup.add(post);
    }
  }

  private buildDoors(floor: Floor): void {
    const material = new THREE.MeshStandardMaterial({ color: "#6B4A32", roughness: 0.55 });

    for (const door of floor.doors) {
      const vertical = door.h > door.w;
      const span = Math.max(door.w, door.h);

      // Which way the room lies, so the door opens into it rather than out into
      // the corridor. Taken from the zone the door belongs to rather than
      // hard-coded, because the rooms have moved four times.
      const zone = floor.zones.find((z) => z.id === door.zoneId);
      const inward = zone
        ? vertical
          ? Math.sign(zone.x + zone.w / 2 - (door.x + door.w / 2))
          : Math.sign(zone.y + zone.h / 2 - (door.y + door.h / 2))
        : 1;

      // The group sits on the hinge, at one end of the opening, and the leaf
      // hangs off it along the opening. Rotating the group then swings the door
      // about its hinge — the box this replaces pivoted about its own middle
      // and had to be shoved sideways to clear the frame, which read as a panel
      // floating in the doorway rather than a door on hinges.
      const group = new THREE.Group();
      group.position.set(
        vertical ? door.x + door.w / 2 : door.x,
        0,
        vertical ? door.y : door.y + door.h / 2,
      );
      group.userData.doorId = door.id;
      group.userData.openAngle = vertical ? (inward > 0 ? Math.PI / 2 : -Math.PI / 2) : (inward > 0 ? -Math.PI / 2 : Math.PI / 2);

      const hang = (object: THREE.Object3D) => {
        object.position.set(vertical ? 0 : span / 2, 0, vertical ? span / 2 : 0);
        if (vertical) object.rotation.y = Math.PI / 2;
      };

      const placeholder = new THREE.Mesh(new THREE.BoxGeometry(span, DOOR_H, 8), material);
      hang(placeholder);
      placeholder.position.y = DOOR_H / 2;
      placeholder.castShadow = true;
      placeholder.receiveShadow = true;
      group.add(placeholder);

      this.worldGroup.add(group);
      this.doorMeshes.push(group);

      void doorLeaf(span, DOOR_H).then((leaf) => {
        if (!leaf) return;
        hang(leaf);
        leaf.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        group.remove(placeholder);
        group.add(leaf);
      });
    }
    this.refreshDoors();
  }

  private buildSigns(floor: Floor): void {
    for (const sign of floor.signs) {
      const label = labelSprite(sign.text, sign.mark ? "#D9B36B" : "#EDE7DC", sign.mark ? 1.9 : 1);
      // Mounted on the wall face, at eye height.
      label.position.set(sign.x + sign.w / 2, sign.mark ? 150 : 132, sign.y + 3);
      this.worldGroup.add(label);
    }
  }

  setDoors(shut: string[]): void {
    this.shutDoors = new Set(shut);
    if (this.floor) this.walls = collisionRects(this.floor, this.shutDoors);
    this.refreshDoors();
  }

  isDoorShut(doorId: string): boolean {
    return this.shutDoors.has(doorId);
  }

  /** A shut door fills its frame; an open one swings back into the room. */
  private refreshDoors(): void {
    for (const mesh of this.doorMeshes) {
      const id = mesh.userData.doorId as string;
      mesh.rotation.y = this.shutDoors.has(id) ? 0 : (mesh.userData.openAngle as number);
    }
  }

  /* ── Avatars ───────────────────────────────────────────────────── */

  private addAvatar(state: PlayerState): void {
    const group = new THREE.Group();
    const isSelf = state.id === this.selfId;
    const color = new THREE.Color(state.color);

    // Everything you actually see of a person is a DOM tile above the canvas.
    // In the scene they leave only a shadow and a ring, which is what ties the
    // tile to a place on the floor.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(PLAYER_RADIUS * 1.15, 32),
      new THREE.MeshBasicMaterial({ color: 0x241d17, transparent: true, opacity: 0.26 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 1.6;
    group.add(shadow);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(PLAYER_RADIUS * 1.4, 2.6, 8, 40),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.6,
        roughness: 0.4,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 2.2;
    ring.visible = false;
    group.add(ring);

    let earshot: THREE.Mesh | null = null;
    if (isSelf) {
      earshot = new THREE.Mesh(
        new THREE.RingGeometry(EARSHOT - 3, EARSHOT, 72),
        new THREE.MeshBasicMaterial({
          color: 0x8fb4cc,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
        }),
      );
      earshot.rotation.x = -Math.PI / 2;
      earshot.position.y = 1.2;
      group.add(earshot);
    }

    group.position.set(state.x, 0, state.y);
    this.avatarGroup.add(group);

    this.avatars.set(state.id, {
      state,
      group,
      shadow,
      ring,
      earshot,
      cur: { x: state.x, y: state.y },
      target: { x: state.x, y: state.y },
      lastGain: -1,
      lastSeeVideo: null,
      lastSendVideo: null,
      lastStatus: null,
    });
  }

  addPlayer(state: PlayerState): void {
    if (!this.avatars.has(state.id)) this.addAvatar(state);
  }

  removePlayer(id: string): void {
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    this.avatarGroup.remove(avatar.group);
    this.avatars.delete(id);
  }

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

  correctPosition(x: number, y: number): void {
    this.local.x = x;
    this.local.y = y;
    this.moveTarget = null;
  }

  setSelfVoice(speaking: boolean, muted: boolean): void {
    const self = this.avatars.get(this.selfId);
    if (!self) return;
    self.state.speaking = speaking;
    self.state.muted = muted;
  }

  setSelfBroadcast(on: boolean): void {
    this.selfBroadcasting = on;
    const self = this.avatars.get(this.selfId);
    if (self) self.state.broadcasting = on;
  }

  setSurface(surface: AvatarSurface | null): void {
    this.surface = surface;
  }

  walkToPlayer(playerId: string): void {
    const target = this.avatars.get(playerId);
    if (!target || playerId === this.selfId) return;
    const fromLeft = this.local.x <= target.cur.x;
    this.moveTarget = {
      x: target.cur.x + (fromLeft ? -1 : 1) * PLAYER_RADIUS * 2.4,
      y: target.cur.y,
    };
  }

  /* ── Input ─────────────────────────────────────────────────────── */

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      this.keys.add(k);
      this.moveTarget = null;
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onBlur = () => this.keys.clear();

  private onPointerDown = (e: PointerEvent) => {
    const renderer = this.renderer;
    const floor = this.floor;
    if (!renderer || !floor) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    // Doors first: they stand in front of the floor behind them, and clicking
    // one should never be read as "walk to the wall".
    const doorHit = this.raycaster.intersectObjects(this.doorMeshes, false)[0];
    if (doorHit) {
      const id = doorHit.object.userData.doorId as string;
      const door = floor.doors.find((d) => d.id === id);
      if (door) {
        this.handleDoor(door.id, door.zoneId);
        return;
      }
    }

    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) return;

    // Clicking the floor right by a door still counts as reaching for it.
    const near = doorAt(point.x, point.z, floor.doors, 20);
    if (near) {
      this.handleDoor(near.id, near.zoneId);
      return;
    }

    this.moveTarget = { x: point.x, y: point.z };
  };

  private handleDoor(doorId: string, zoneId: string): void {
    const floor = this.floor;
    if (!floor) return;
    const myZone = zoneAt(this.local.x, this.local.y, floor.zones);
    const shut = this.shutDoors.has(doorId);

    if (myZone === zoneId) this.callbacks.onDoorToggle(doorId, shut);
    else if (shut) this.callbacks.onKnock(doorId);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const next = this.distance * (e.deltaY > 0 ? 1.06 : 0.94);
    this.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, next));
  };

  private bindInput(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.renderer?.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer?.domElement.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private unbindInput(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.renderer?.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer?.domElement.removeEventListener("wheel", this.onWheel);
  }

  /* ── Frame ─────────────────────────────────────────────────────── */

  private startLoop(): void {
    this.lastFrameAt = performance.now();
    const frame = (now: number) => {
      if (this.destroyed) return;
      const dt = Math.min((now - this.lastFrameAt) / 1000, 0.05);
      this.lastFrameAt = now;
      this.tick(dt);
      this.frameId = requestAnimationFrame(frame);
    };
    this.frameId = requestAnimationFrame(frame);
  }

  private tick(dt: number): void {
    const renderer = this.renderer;
    const floor = this.floor;
    if (!renderer) return;

    this.elapsed += dt;

    if (floor) {
      this.moveLocal(dt, floor);
      this.smoothRemotes(dt);
      this.updateAudio(floor);
      this.updateChrome();
      this.updateCamera();
      this.placeSurface(renderer);
      this.reportPosition(dt);
    }

    renderer.render(this.scene, this.camera);
  }

  private moveLocal(dt: number, floor: Floor): void {
    let dx = 0;
    let dz = 0;

    if (this.keys.has("a") || this.keys.has("arrowleft")) dx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx += 1;
    if (this.keys.has("w") || this.keys.has("arrowup")) dz -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dz += 1;

    if (dx === 0 && dz === 0 && this.moveTarget) {
      const tx = this.moveTarget.x - this.local.x;
      const ty = this.moveTarget.y - this.local.y;
      const dist = Math.hypot(tx, ty);
      if (dist < 6) {
        this.moveTarget = null;
      } else {
        dx = tx / dist;
        dz = ty / dist;
      }
    }

    const self = this.avatars.get(this.selfId);
    if (dx === 0 && dz === 0) return;

    const len = Math.hypot(dx, dz) || 1;
    const next = {
      x: this.local.x + (dx / len) * MOVE_SPEED * dt,
      y: this.local.y + (dz / len) * MOVE_SPEED * dt,
    };

    this.local = resolveMove(this.local, next, PLAYER_RADIUS, this.walls, floor);

    if (self) {
      self.cur = { ...this.local };
      self.group.position.set(this.local.x, 0, this.local.y);
    }
  }

  private smoothRemotes(dt: number): void {
    const k = 1 - Math.exp(-14 * dt);
    for (const [id, avatar] of this.avatars) {
      if (id === this.selfId) continue;
      avatar.cur.x += (avatar.target.x - avatar.cur.x) * k;
      avatar.cur.y += (avatar.target.y - avatar.cur.y) * k;
      avatar.group.position.set(avatar.cur.x, 0, avatar.cur.y);
    }
  }

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
    }
  }

  private updateChrome(): void {
    const pulse = 1 + Math.sin(this.elapsed * 7) * 0.12;

    for (const avatar of this.avatars.values()) {
      const talking = avatar.state.speaking && !avatar.state.muted;
      avatar.ring.visible = talking;
      if (talking) avatar.ring.scale.setScalar(pulse);

      // Someone away fades on the floor as well as in the roster.
      if (avatar.state.status !== avatar.lastStatus) {
        avatar.lastStatus = avatar.state.status;
        const material = avatar.shadow.material as THREE.MeshBasicMaterial;
        material.opacity = avatar.state.status === "away" ? 0.12 : 0.26;
      }
    }
  }

  private updateCamera(): void {
    const view = this.cameraOverride;
    const target = view
      ? new THREE.Vector3(view.x, 60, view.y)
      : new THREE.Vector3(this.local.x, 60, this.local.y);

    this.camera.position.copy(target).addScaledVector(VIEW_DIR, view?.distance ?? this.distance);
    this.camera.lookAt(target);
  }

  /** Point the camera at a spot on the plan. For the screenshot tool. */
  lookAtPoint(x: number, y: number, distance: number): void {
    this.cameraOverride = { x, y, distance };
    // Fog is set for a person standing on the floor; from a wide shot it greys
    // out everything past the middle of the room.
    this.scene.fog = null;
  }

  /** Pull back far enough to see the whole floor. */
  frameAll(): void {
    const floor = this.floor;
    if (!floor) return;
    this.lookAtPoint(floor.width / 2, floor.height / 2, Math.max(floor.width, floor.height) * 1.25);
  }

  /**
   * Project each head into screen space for the DOM video circles.
   *
   * Diameter comes from projecting a second point one head-radius up, so the
   * circles shrink with distance exactly as the bodies do.
   */
  private placeSurface(renderer: THREE.WebGLRenderer): void {
    const surface = this.surface;
    if (!surface) return;

    surface.beginFrame();

    const width = renderer.domElement.clientWidth;
    const height = renderer.domElement.clientHeight;
    const head = new THREE.Vector3();
    const rim = new THREE.Vector3();
    // The camera's own up, so the offset is perpendicular to the view and the
    // circles do not foreshorten as the camera tilts.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);

    for (const [id, avatar] of this.avatars) {
      head.set(avatar.cur.x, TILE_Y, avatar.cur.y);
      rim.copy(head).addScaledVector(up, PLAYER_RADIUS * 1.35);

      head.project(this.camera);
      rim.project(this.camera);

      // Behind the camera, or off the edge.
      if (head.z > 1) continue;

      const sx = (head.x * 0.5 + 0.5) * width;
      const sy = (-head.y * 0.5 + 0.5) * height;
      const ry = (-rim.y * 0.5 + 0.5) * height;
      const diameter = Math.max(18, Math.abs(sy - ry) * 2);

      if (sx < -diameter || sy < -diameter || sx > width + diameter || sy > height + diameter) {
        continue;
      }
      surface.place(id, sx, sy, diameter);
    }

    surface.endFrame();
  }

  private reportPosition(dt: number): void {
    this.sendAccumulator += dt;
    if (this.sendAccumulator < 1 / SEND_HZ) return;
    this.sendAccumulator = 0;

    if (
      Math.abs(this.local.x - this.lastSent.x) < 0.5 &&
      Math.abs(this.local.y - this.lastSent.y) < 0.5
    ) {
      return;
    }
    this.lastSent = { ...this.local };
    this.callbacks.onPositionChange(this.local.x, this.local.y);
  }
}
