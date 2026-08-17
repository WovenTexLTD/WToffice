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
import { floorMaterial, labelSprite, outdoorMaterial, skyTexture, wallMaterial } from "./textures";

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

/**
 * How big a person reads on screen, in world units.
 *
 * Deliberately not derived from PLAYER_RADIUS. That is the body's collision
 * radius, and it wants to be small so doorways are comfortable to walk through
 * — but the tile above it wants to be large enough to see a face in. Tying the
 * two together means every change to one silently resizes the other.
 */
const TILE_RADIUS = 43;

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
  /** Set once the post chain loads; until then the scene renders direct. */
  private composer: { render: () => void; setSize: (w: number, h: number) => void } | null = null;
  /** Kept so the shadow map can be redrawn on the rare occasions it changes. */
  private sun: THREE.DirectionalLight | null = null;

  /**
   * Where the camera is looking, which trails where you are.
   *
   * Welded to the body it inherits every unevenness in the frame timing:
   * movement is speed x dt, so a frame that takes 12ms and one that takes 30ms
   * move you different distances, and with the camera locked on, the whole room
   * jerks by that difference while you sit still in the middle of it. Damping
   * spends the error over several frames instead of showing it on one.
   */
  private eye = new THREE.Vector3();
  private eyeReady = false;

  /**
   * How much work each frame is allowed.
   *
   * 2 is everything; 1 drops the occlusion pass; 0 also halves the pixels.
   * Stepped down by measurement rather than by guessing at the machine — the
   * office runs on whatever laptop someone opens it on, and the same settings
   * are comfortable on one and unusable on another.
   */
  private quality = 2;
  private frameTimes: number[] = [];
  /** Wall-clock moment sampling may begin; 0 until the first frame. */
  private qualityFrom = 0;
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
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      // Laptops with two GPUs default to the economical one otherwise.
      powerPreference: "high-performance",
    });
    // 1.5 rather than 2. On a retina display 2 means four times the pixels of
    // 1, and with an occlusion pass and MSAA on top of that it is the single
    // most expensive number in the renderer. At this camera distance the
    // difference between 1.5 and 2 is not visible; the frame rate is.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic tone mapping is most of why a rendered room looks photographic
    // rather than like flat-shaded plastic.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    if (this.destroyed) {
      renderer.dispose();
      return;
    }

    this.renderer = renderer;
    this.container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    this.scene.background = skyTexture();
    // Pushed well out, and the colour of the horizon rather than of nothing:
    // the surroundings need to fade into the sky at the far edge instead of
    // stopping dead, and the office itself must not be greyed out on the way.
    this.scene.fog = new THREE.Fog("#B9C6CE", 5200, 15000);
    this.scene.add(this.worldGroup);
    this.scene.add(this.avatarGroup);

    await this.setupEnvironment(renderer);
    this.setupLights();
    void this.setupPost();
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
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }

  /**
   * Ambient occlusion.
   *
   * This is what the room was missing. Every model in the pack is a flat colour
   * with no surface detail — the pack ships one image of colour swatches for all
   * 1,740 of them — so there is nothing in the materials to catch the light.
   * Without occlusion at the contacts, a chair leg and the floor it stands on
   * are the same brightness where they meet, and the whole floor reads flat.
   *
   * Loaded after the scene is up, and skipped entirely if it fails: a room that
   * renders slightly flat beats a room that does not render.
   */
  private async setupPost(): Promise<void> {
    try {
      const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }] = await Promise.all([
        import("three/examples/jsm/postprocessing/EffectComposer.js"),
        import("three/examples/jsm/postprocessing/RenderPass.js"),
        import("three/examples/jsm/postprocessing/GTAOPass.js"),
        import("three/examples/jsm/postprocessing/OutputPass.js"),
      ]);
      const renderer = this.renderer;
      if (!renderer || this.destroyed) return;

      const w = this.container.clientWidth || 1;
      const h = this.container.clientHeight || 1;

      // The renderer's own antialiasing only applies when it draws straight to
      // the canvas. Rendering into a composer target bypasses it, which is why
      // adding the pass made every edge jagged — so the target asks for MSAA
      // itself. Half-float keeps highlights intact for the tone mapping at the
      // end of the chain.
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(buffer.x, buffer.y, {
        type: THREE.HalfFloatType,
        samples: 2,
      });

      const composer = new EffectComposer(renderer, target);
      composer.addPass(new RenderPass(this.scene, this.camera));

      const ao = new GTAOPass(this.scene, this.camera, w, h);
      // Occlusion at half resolution, blended back at full. It is a broad, soft
      // signal — the contact shadow under a chair leg is several pixels wide —
      // so halving it costs almost nothing visible and a quarter of the work.
      const resize = ao.setSize.bind(ao);
      ao.setSize = (width: number, height: number) =>
        resize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
      // Radius in world units. The floor is 2600 across and a chair is 55, so a
      // radius of a few units keeps the darkening at the contacts rather than
      // smearing it across whole rooms.
      ao.updateGtaoMaterial({ radius: 12, distanceExponent: 1.2, thickness: 24, scale: 1.1 });
      ao.blendIntensity = 0.85;
      composer.addPass(ao);

      // ACES and the colour space conversion move to the end of the chain once
      // there is a chain; without this the whole image comes back washed out.
      composer.addPass(new OutputPass());
      composer.setSize(w, h);

      this.composer = composer;
    } catch (error) {
      console.warn("[office] ambient occlusion unavailable, rendering direct", error);
    }
  }

  private setupLights(): void {
    // Carries the interior. A single hard sun with little fill gives an office
    // the shadows of a car park at five o'clock.
    // Deliberately low. Ambient light arrives from every direction at once, so
    // it is the one thing that cannot describe a shape — piling it on is what
    // made the office look flat. The sun and the occlusion pass do the work now.
    this.scene.add(new THREE.HemisphereLight(0xe6edf4, 0x7a6a55, 0.62));

    // High and soft. At a low angle every object throws a long hard shadow
    // across the floor, which reads as outdoors — interiors are lit from much
    // closer to overhead, and the shadows are short and diffuse.
    const sun = new THREE.DirectionalLight(0xfff4e4, 2.35);
    this.sun = sun;
    sun.castShadow = true;

    /*
     * Drawn on demand, not every frame.
     *
     * The shadow pass is a second pass over every casting mesh in the scene,
     * and it was producing an identical map sixty times a second: the office is
     * furniture, and furniture does not move. People are the only thing that
     * does, and they are drawn as a tile with a painted circle beneath them
     * rather than as shadow casters.
     *
     * Anything that genuinely changes the scene calls invalidateShadows().
     */
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 2;
    sun.shadow.radius = 3.5;

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
    const fill = new THREE.DirectionalLight(0xd6e4f0, 0.40);
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
      this.composer?.setSize(w, h);
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

    this.buildSurroundings(floor);
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
        // Arrives after the first shadow pass, so that pass is now out of date.
        this.invalidateShadows();
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

  /**
   * Outside.
   *
   * The building stood in flat black, which reads as a model on a table rather
   * than a place. From this camera the sky is barely in frame and the ground is
   * most of it, so that is where the work goes: grass out to the fog, a paved
   * apron the building sits on, and enough neighbouring massing at the edges to
   * suggest the office is somewhere rather than nowhere.
   *
   * Deliberately coarse. None of it is ever closer than a few metres past the
   * outer wall, and detail spent out here is detail not spent on the floor.
   */
  private buildSurroundings(floor: Floor): void {
    const cx = floor.width / 2;
    const cz = floor.height / 2;

    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(26000, 26000),
      outdoorMaterial("grass", 26000),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(cx, -10, cz);
    grass.receiveShadow = true;
    this.worldGroup.add(grass);

    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(floor.width + 430, floor.height + 430),
      outdoorMaterial("paving", floor.width + 430),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(cx, -4, cz);
    apron.receiveShadow = true;
    this.worldGroup.add(apron);

    // Neighbours. Placed on a ring well outside the apron and varied by index
    // rather than at random, so the view is the same for everyone in the room.
    const brick = new THREE.MeshStandardMaterial({ color: "#7C5B4E", roughness: 0.9 });
    const rendered = new THREE.MeshStandardMaterial({ color: "#9AA0A2", roughness: 0.85 });
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + 0.3;
      const radius = 1980 + (i % 4) * 430;
      const w = 420 + (i % 5) * 190;
      const d = 380 + (i % 3) * 240;
      const h = 300 + (i % 6) * 220;

      const block = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        i % 2 === 0 ? brick : rendered,
      );
      block.position.set(cx + Math.cos(angle) * radius, h / 2, cz + Math.sin(angle) * radius);
      block.rotation.y = angle;
      block.castShadow = true;
      block.receiveShadow = true;
      this.worldGroup.add(block);
    }
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
        this.invalidateShadows();
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
        this.invalidateShadows();
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
    // wall_003's colour. That model is a 4m plane whose 312 vertices all map to
    // a single texel of the pack's shared palette atlas — the whole pack is one
    // 23KB image of swatches, which is how 1,740 models ship with 2.6KB of
    // texture between them. So there is no wall pattern to apply, only the
    // colour it points at, and a flat mesh laid over these walls would have
    // added geometry for nothing.
    const skirting = new THREE.MeshStandardMaterial({ color: "#6E564E", roughness: 0.8 });

    for (const w of floor.walls) {
      if (w.glass) {
        this.buildGlazedWall(w);
        continue;
      }

      // Brick sized to this wall's own run, so the courses are the same height
      // on a 30m elevation as on a 3m one.
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w.w, WALL_H, w.h),
        wallMaterial(Math.max(w.w, w.h), WALL_H),
      );
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

    this.buildEntrance(floor.entrance);
  }

  /**
   * The front doors.
   *
   * A pair of leaves in a frame, not the single translucent slab that stood
   * here before: a sheet of glass set into a wall reads as a window at best and
   * a rendering mistake at worst, and this is the first thing anyone sees.
   *
   * Hinged at the jambs and meeting on the centre line, using the same leaf as
   * every other door on the floor so the building agrees with itself.
   */
  private buildEntrance(e: { x: number; y: number; w: number; h: number }): void {
    const H = WALL_H * 0.86;
    // Stood proud of the wall's inner face rather than inside it. The opening
    // is decorative — the wall behind stays solid — so anything sharing the
    // wall's own 14 units is drawn over by the brick and invisible from the
    // room, which is exactly what happened the first time.
    const px = e.x + e.w + 9;
    const frame = new THREE.MeshStandardMaterial({
      color: "#3C4046",
      roughness: 0.42,
      metalness: 0.55,
    });

    const jamb = (z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(18, H, 14), frame);
      mesh.position.set(px, H / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.worldGroup.add(mesh);
    };
    jamb(e.y + 6);
    jamb(e.y + e.h - 6);

    // The head beam is what turns two posts into a doorway.
    const head = new THREE.Mesh(new THREE.BoxGeometry(18, 15, e.h), frame);
    head.position.set(px, H - 8, e.y + e.h / 2);
    head.castShadow = true;
    this.worldGroup.add(head);

    const span = e.h / 2 - 12;
    for (const side of [-1, 1] as const) {
      const hinge = new THREE.Group();
      hinge.position.set(px, 0, e.y + e.h / 2 - side * span);
      this.worldGroup.add(hinge);

      void doorLeaf(span, H - 14).then((leaf) => {
        this.invalidateShadows();
        if (!leaf) return;
        leaf.position.z = (side * span) / 2;
        leaf.rotation.y = Math.PI / 2;
        leaf.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        hinge.add(leaf);
      });
    }

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
        this.invalidateShadows();
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

  /**
   * What the renderer is actually being asked to do.
   *
   * Frame rate on its own says "slow" and nothing else. Draw calls, triangles
   * and the size of the shadow pass say which part is slow, which is the
   * difference between fixing it and guessing at it.
   */
  stats(): Record<string, number> {
    const renderer = this.renderer;
    if (!renderer) return {};
    const { render, memory, programs } = renderer.info;
    return {
      calls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      programs: programs?.length ?? 0,
      // Meshes in the world, which is the ceiling on how many calls there can be.
      objects: this.worldGroup.children.length + this.avatarGroup.children.length,
      quality: this.quality,
    };
  }

  /**
   * Watch the frame time and give something up if it is not keeping pace.
   *
   * Judged on the median of a long window, never the worst frame: loading a
   * model or opening a panel produces a slow frame that says nothing about
   * whether the machine can hold sixty. Only ever steps down — stepping back up
   * would find the threshold again and oscillate across it.
   */
  private trackQuality(frameMs: number): void {
    if (this.quality === 0) return;

    // Real elapsed time, not the simulation's dt — that is clamped to 50ms so a
    // stalled tab cannot teleport anyone, and measuring with it makes a slow
    // machine look merely half as slow as it is.
    const now = performance.now();
    if (this.qualityFrom === 0) {
      this.qualityFrom = now + 6000;
      return;
    }
    // Frames while the world is still arriving are not representative.
    if (now < this.qualityFrom) return;

    this.frameTimes.push(frameMs);
    if (this.frameTimes.length < 120) return;

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.frameTimes = [];

    // 22ms is about 45fps — comfortably below where moving starts to drag.
    if (median <= 22) return;

    this.reduceQuality();
  }

  /**
   * Give up one level of visual work.
   *
   * Public so it can be driven directly — the frame rate that triggers it
   * cannot be produced on demand, and a fallback that has never once been run
   * is a fallback nobody should trust.
   */
  reduceQuality(): void {
    if (this.quality === 2) {
      this.quality = 1;
      // Straight to the canvas, which also restores the renderer's own MSAA.
      this.composer = null;
      console.info("[office] dropped ambient occlusion to keep the frame rate up");
      return;
    }
    if (this.quality === 1) {
      this.quality = 0;
      this.renderer?.setPixelRatio(1);
      console.info("[office] reduced resolution to keep the frame rate up");
    }
  }

  /** Redraw the shadow map once, next frame. */
  private invalidateShadows(): void {
    if (this.sun) this.sun.shadow.needsUpdate = true;
  }

  /** A shut door fills its frame; an open one swings back into the room. */
  private refreshDoors(): void {
    for (const mesh of this.doorMeshes) {
      const id = mesh.userData.doorId as string;
      mesh.rotation.y = this.shutDoors.has(id) ? 0 : (mesh.userData.openAngle as number);
    }
    this.invalidateShadows();
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
      new THREE.CircleGeometry(TILE_RADIUS * 0.58, 32),
      new THREE.MeshBasicMaterial({ color: 0x241d17, transparent: true, opacity: 0.26 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 1.6;
    group.add(shadow);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(TILE_RADIUS * 0.72, 2.6, 8, 40),
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
    // A correction is a jump, not a stroll — easing into it would drag the
    // whole room sideways for half a second.
    this.eyeReady = false;
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
      const frameMs = now - this.lastFrameAt;
      // Clamped for the simulation so a stalled tab cannot teleport anyone.
      const dt = Math.min(frameMs / 1000, 0.05);
      this.lastFrameAt = now;
      this.tick(dt, frameMs);
      this.frameId = requestAnimationFrame(frame);
    };
    this.frameId = requestAnimationFrame(frame);
  }

  private tick(dt: number, frameMs: number): void {
    const renderer = this.renderer;
    const floor = this.floor;
    if (!renderer) return;

    this.elapsed += dt;

    if (floor) {
      this.moveLocal(dt, floor);
      this.smoothRemotes(dt);
      this.updateAudio(floor);
      this.updateChrome();
      this.updateCamera(dt);
      this.placeSurface(renderer);
      this.reportPosition(dt);
    }

    this.trackQuality(frameMs);

    // Counters accumulate across every pass in the frame rather than being
    // wiped by each one, so what they report is the frame's real cost and not
    // the composer's final blit.
    renderer.info.autoReset = false;
    renderer.info.reset();

    if (this.composer) this.composer.render();
    else renderer.render(this.scene, this.camera);
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

  private updateCamera(dt: number): void {
    const view = this.cameraOverride;

    if (view) {
      // The screenshot camera is placed, not followed.
      const fixed = new THREE.Vector3(view.x, 60, view.y);
      this.eye.copy(fixed);
      this.eyeReady = true;
      this.camera.position.copy(fixed).addScaledVector(VIEW_DIR, view.distance);
      this.camera.lookAt(fixed);
      return;
    }

    const want = new THREE.Vector3(this.local.x, 60, this.local.y);
    if (!this.eyeReady) {
      this.eye.copy(want);
      this.eyeReady = true;
    } else {
      // Framerate-independent damping: the same easing whether the machine is
      // managing 60 frames a second or 30.
      this.eye.lerp(want, 1 - Math.exp(-11 * dt));
    }

    this.camera.position.copy(this.eye).addScaledVector(VIEW_DIR, this.distance);
    this.camera.lookAt(this.eye);
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
      rim.copy(head).addScaledVector(up, TILE_RADIUS);

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
