/**
 * Materials, generated at runtime onto a canvas.
 *
 * Real surfaces need a texture — a flat colour lit by a directional light still
 * reads as plastic. Drawing them procedurally means no assets to download, no
 * licences, and they stay crisp at any resolution.
 *
 * Each returns a tiling colour map plus a matching roughness map, so oak reads
 * as satin-finished wood and tile reads as glazed while carpet stays matte.
 */

import * as THREE from "three";

const TILE_PX = 1024;

/**
 * World units covered by one texture tile — about four metres.
 *
 * Repeat is derived from this and the surface's own size, so a plank is the
 * same width on a 2600-unit floor as on a 400-unit one. A fixed repeat stretches
 * the texture by whatever the surface's aspect happens to be.
 */
const TILE_WORLD = 340;

function surface(draw: (ctx: CanvasRenderingContext2D, size: number) => void): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx, TILE_PX);
  return canvas;
}

function toTexture(canvas: HTMLCanvasElement, repeat: number): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Deterministic, so the floor is identical for everyone in the room. */
function rand(seed: number): number {
  const n = Math.sin(seed * 127.1) * 43758.5453;
  return n - Math.floor(n);
}

/* ── Oak ──────────────────────────────────────────────────────────── */

/**
 * Boards, staggered row to row, each shaded slightly differently.
 *
 * Lightness is a parameter because "wood flooring" covers everything from pale
 * ash to dark walnut, and it is the one value worth tuning by eye. Grain and
 * seams are derived from it so the whole board darkens together.
 */
function oakCanvas(base = 74, sat = 20, hue = 34): HTMLCanvasElement {
  return surface((ctx, size) => {
    const rows = 12;
    const rowH = size / rows;
    const plankLen = size / 2;

    for (let row = 0; row < rows; row++) {
      // Thirds rather than halves, so the joints do not line up every other row.
      const stagger = ((row % 3) / 3) * plankLen;

      for (let i = -1; i < 3; i++) {
        const x = stagger + i * plankLen;
        const seed = row * 13 + i * 7;
        const light = base + (rand(seed) - 0.5) * 9;

        ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
        ctx.fillRect(x, row * rowH, plankLen, rowH);

        // Grain, clipped to the board so strokes never run across a joint.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, row * rowH, plankLen, rowH);
        ctx.clip();
        ctx.strokeStyle = `hsla(${hue - 3}, ${sat + 6}%, ${light - 15}%, 0.2)`;
        ctx.lineWidth = 1.3;
        for (let g = 0; g < 9; g++) {
          const gy = row * rowH + rand(seed + g * 3) * rowH;
          ctx.beginPath();
          ctx.moveTo(x - 4, gy);
          ctx.bezierCurveTo(
            x + plankLen * 0.3, gy + (rand(g + i) - 0.5) * 8,
            x + plankLen * 0.7, gy + (rand(g + row) - 0.5) * 8,
            x + plankLen + 4, gy,
          );
          ctx.stroke();
        }
        ctx.restore();

        // A dark line on the top and left edges reads as the bevel between
        // boards, which is most of what makes a floor look laid rather than
        // printed.
        ctx.fillStyle = `hsla(${hue - 6}, ${sat}%, ${base - 28}%, 0.45)`;
        ctx.fillRect(x, row * rowH, plankLen, 2);
        ctx.fillRect(x, row * rowH, 2, rowH);
      }
    }
  });
}

/* ── Tile ─────────────────────────────────────────────────────────── */

function tileCanvas(): HTMLCanvasElement {
  return surface((ctx, size) => {
    const n = 4;
    const cell = size / n;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const shade = rand(row * 19 + col * 23);
        ctx.fillStyle = `hsl(45, 9%, ${85 + shade * 5}%)`;
        ctx.fillRect(col * cell, row * cell, cell, cell);
        // Faint mottling, so each tile is not perfectly flat.
        ctx.fillStyle = `hsla(45, 12%, ${70 + shade * 10}%, 0.16)`;
        for (let s = 0; s < 12; s++) {
          const sx = col * cell + rand(s + row * 3) * cell;
          const sy = row * cell + rand(s + col * 5) * cell;
          ctx.beginPath();
          ctx.arc(sx, sy, 3 + rand(s) * 9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // Grout.
    ctx.strokeStyle = "hsla(42, 10%, 62%, 0.9)";
    ctx.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, size);
      ctx.moveTo(0, i * cell);
      ctx.lineTo(size, i * cell);
      ctx.stroke();
    }
  });
}

/* ── Carpet ───────────────────────────────────────────────────────── */

/**
 * Carpet as a plain weave — warp and weft crossing, which is what carpet looks
 * like up close and, conveniently, the brand.
 *
 * Hue, saturation and the lightness range are parameters so the same weave can
 * be a warm beige or a dark charcoal without a second generator.
 */
function carpetCanvas(hue: number, sat: number, base: number, spread: number): HTMLCanvasElement {
  return surface((ctx, size) => {
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${base + spread / 2}%)`;
    ctx.fillRect(0, 0, size, size);

    const pitch = 8;
    for (let y = 0; y < size; y += pitch) {
      for (let x = 0; x < size; x += pitch) {
        const over = ((x / pitch + y / pitch) | 0) % 2 === 0;
        const shade = base + rand(x * 0.7 + y * 1.3) * spread;
        ctx.fillStyle = `hsl(${hue}, ${sat}%, ${shade}%)`;
        if (over) ctx.fillRect(x, y + pitch * 0.22, pitch, pitch * 0.56);
        else ctx.fillRect(x + pitch * 0.22, y, pitch * 0.56, pitch);
      }
    }
  });
}

/* ── Brick ───────────────────────────────────────────────────────── */

/**
 * Running bond: courses of brick, every other one offset by half a brick.
 *
 * Drawn rather than photographed for the same reason as the floors — but here
 * there was no choice. This pack ships one 23KB image of flat colour swatches
 * for all 1,740 models, so there is no brick texture anywhere in it to use.
 *
 * The mortar is drawn as the background and the bricks laid over it, which is
 * both how a wall is built and one fewer pass than drawing the joints.
 */
function brickCanvas(): HTMLCanvasElement {
  return surface((ctx, size) => {
    const courses = 26; // ~65mm brick over the 1.7m this tile covers
    const perCourse = 8;
    const courseH = size / courses;
    const brickW = size / perCourse;
    const joint = Math.max(2, courseH * 0.16);

    ctx.fillStyle = "hsl(34, 9%, 68%)";
    ctx.fillRect(0, 0, size, size);

    for (let row = 0; row < courses; row++) {
      // Half-brick offset on alternate courses, which is what stops the joints
      // running in unbroken vertical lines.
      const stagger = row % 2 === 0 ? 0 : brickW / 2;

      for (let i = -1; i < perCourse + 1; i++) {
        const x = stagger + i * brickW;
        const y = row * courseH;
        const seed = row * 17 + i * 5;
        const light = 40 + (rand(seed) - 0.5) * 13;
        const hue = 12 + (rand(seed + 3) - 0.5) * 8;

        ctx.fillStyle = `hsl(${hue}, 34%, ${light}%)`;
        ctx.fillRect(x, y, brickW - joint, courseH - joint);

        // A lighter top edge and darker bottom: bricks are not flat, and this
        // is most of what stops the wall reading as printed paper.
        ctx.fillStyle = `hsla(${hue}, 30%, ${light + 9}%, 0.55)`;
        ctx.fillRect(x, y, brickW - joint, 1.5);
        ctx.fillStyle = `hsla(${hue}, 34%, ${light - 12}%, 0.5)`;
        ctx.fillRect(x, y + courseH - joint - 1.5, brickW - joint, 1.5);
      }
    }
  });
}

/* ── Outside ──────────────────────────────────────────────────────── */

/** Rough grass: a mat of short strokes rather than a flat green field. */
function grassCanvas(): HTMLCanvasElement {
  return surface((ctx, size) => {
    ctx.fillStyle = "hsl(96, 22%, 34%)";
    ctx.fillRect(0, 0, size, size);
    ctx.lineWidth = 2;
    for (let i = 0; i < 9000; i++) {
      const x = rand(i * 1.7) * size;
      const y = rand(i * 2.3 + 11) * size;
      const light = 26 + rand(i * 3.1) * 20;
      ctx.strokeStyle = `hsl(${92 + rand(i) * 16}, ${18 + rand(i * 5) * 14}%, ${light}%)`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand(i * 7) - 0.5) * 5, y - 3 - rand(i * 9) * 5);
      ctx.stroke();
    }
  });
}

/** Paving slabs, for the apron the building stands on. */
function pavingCanvas(): HTMLCanvasElement {
  return surface((ctx, size) => {
    const n = 6;
    const cell = size / n;
    ctx.fillStyle = "hsl(40, 5%, 52%)";
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const shade = rand(row * 31 + col * 17);
        ctx.fillStyle = `hsl(40, 5%, ${58 + shade * 9}%)`;
        ctx.fillRect(col * cell + 2, row * cell + 2, cell - 4, cell - 4);
      }
    }
  });
}

/**
 * The sky, as a vertical gradient.
 *
 * Mapped equirectangularly, so the canvas's vertical axis becomes elevation:
 * deep blue overhead easing to a pale haze at the horizon, which is where this
 * camera actually looks.
 */
export function skyTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#3E76B8");
    grad.addColorStop(0.42, "#7FA9D6");
    grad.addColorStop(0.52, "#CBDCE9");
    grad.addColorStop(0.66, "#B9C6CE");
    grad.addColorStop(1, "#8E9AA1");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, 512);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Ground covering outside the building, sized to the patch it covers. */
export function outdoorMaterial(name: "grass" | "paving", size: number): THREE.MeshStandardMaterial {
  const canvas = name === "grass" ? grassCanvas() : pavingCanvas();
  const map = toTexture(canvas, Math.max(1, Math.round(size / (name === "grass" ? 600 : 400))));
  return new THREE.MeshStandardMaterial({ map, roughness: name === "grass" ? 0.98 : 0.86 });
}

/* ── Roughness ────────────────────────────────────────────────────── */

/** Greyscale noise, used as a roughness map so highlights break up. */
function roughnessCanvas(base: number, variance: number): HTMLCanvasElement {
  return surface((ctx, size) => {
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const pixel = i / 4;
      const v = (base + (rand(pixel) - 0.5) * variance) * 255;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  });
}

export interface SurfaceMaps {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

let cache: Record<string, SurfaceMaps> | null = null;

/**
 * Built once and shared. Generating these is the most expensive thing that
 * happens at start-up, and every floor of the same material can share them.
 */
export type SurfaceName =
  | "oak"
  | "walnut"
  | "tile"
  | "carpet"
  | "carpetDark"
  | "concrete"
  | "navy"
  | "brick";

export function surfaces(): Record<SurfaceName, SurfaceMaps> {
  if (cache) return cache as Record<SurfaceName, SurfaceMaps>;

  const rough = (b: number, v: number, repeat: number) => toTexture(roughnessCanvas(b, v), repeat);

  cache = {
    // Mid-tone boards. Raise the first argument for a paler floor, lower it for
    // walnut — it is the one number worth adjusting by eye.
    // Pale boards. Raise the first argument for a whiter floor, lower it for
    // walnut — it is the one number worth adjusting by eye.
    oak: { map: toTexture(oakCanvas(74), 1), roughnessMap: rough(0.5, 0.22, 1) },
    // The warmer, browner board used inside the rooms and across the studio.
    walnut: { map: toTexture(oakCanvas(47, 33, 30), 1), roughnessMap: rough(0.55, 0.25, 1) },
    tile: { map: toTexture(tileCanvas(), 1), roughnessMap: rough(0.28, 0.16, 1) },
    // Warm beige.
    carpet: { map: toTexture(carpetCanvas(36, 14, 62, 12), 1), roughnessMap: rough(0.95, 0.1, 1) },
    // Mid commercial grey, slightly cool so it does not read as brown. Charcoal
    // at this size stops looking like carpet and starts looking like tarmac.
    carpetDark: { map: toTexture(carpetCanvas(212, 4, 37, 7), 1), roughnessMap: rough(0.97, 0.08, 1) },
    concrete: { map: toTexture(tileCanvas(), 1), roughnessMap: rough(0.8, 0.2, 1) },
    // Rug navy. Deeper and more saturated than the floor carpets, because a rug
    // is meant to be seen as an object on the floor rather than as the floor.
    navy: { map: toTexture(carpetCanvas(217, 34, 21, 9), 1), roughnessMap: rough(0.96, 0.1, 1) },
    brick: { map: toTexture(brickCanvas(), 1), roughnessMap: rough(0.92, 0.14, 1) },
  };
  return cache as Record<SurfaceName, SurfaceMaps>;
}

const ROUGHNESS: Record<SurfaceName, number> = {
  oak: 0.6,
  walnut: 0.62,
  tile: 0.32,
  carpet: 0.98,
  carpetDark: 0.98,
  concrete: 0.85,
  navy: 0.99,
  brick: 0.95,
};

/**
 * A floor material sized to the surface it covers.
 *
 * Textures are cloned so each surface carries its own repeat — they share the
 * one canvas, so this costs a wrapper object rather than another megabyte.
 */
export function floorMaterial(
  name: SurfaceName,
  width: number,
  height: number,
): THREE.MeshStandardMaterial {
  const maps = surfaces()[name];
  const map = maps.map.clone();
  const roughnessMap = maps.roughnessMap.clone();

  const rx = Math.max(1, Math.round(width / TILE_WORLD));
  const ry = Math.max(1, Math.round(height / TILE_WORLD));
  map.repeat.set(rx, ry);
  roughnessMap.repeat.set(rx, ry);

  return new THREE.MeshStandardMaterial({ map, roughnessMap, roughness: ROUGHNESS[name] });
}

/** World units one brick tile covers — about 1.7 metres. */
const BRICK_WORLD = 170;

/**
 * Brick sized to the wall it clads.
 *
 * Repeat is rounded to whole tiles so the running bond meets itself at the
 * wrap rather than cutting a brick in half down the length of the wall.
 */
export function wallMaterial(length: number, height: number): THREE.MeshStandardMaterial {
  const maps = surfaces().brick;
  const map = maps.map.clone();
  const roughnessMap = maps.roughnessMap.clone();

  const rx = Math.max(1, Math.round(length / BRICK_WORLD));
  const ry = Math.max(1, Math.round(height / BRICK_WORLD));
  map.repeat.set(rx, ry);
  roughnessMap.repeat.set(rx, ry);

  return new THREE.MeshStandardMaterial({ map, roughnessMap, roughness: ROUGHNESS.brick });
}

/** A canvas-backed label that always faces the camera. */
export function labelSprite(text: string, color: string, scale = 1): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = "600 44px -apple-system, system-ui, sans-serif";

  if (ctx) {
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(text).width) + 40;
    canvas.width = width;
    canvas.height = 68;

    const c = canvas.getContext("2d");
    if (c) {
      c.font = font;
      c.textAlign = "center";
      c.textBaseline = "middle";
      // A soft plate behind the type keeps it readable over any surface.
      c.fillStyle = "rgba(24, 20, 17, 0.55)";
      c.beginPath();
      c.roundRect(0, 8, width, 52, 26);
      c.fill();
      c.fillStyle = color;
      c.fillText(text, width / 2, 35);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set((canvas.width / 68) * 34 * scale, 34 * scale, 1);
  return sprite;
}
