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
export type SurfaceName = "oak" | "walnut" | "tile" | "carpet" | "carpetDark" | "concrete";

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
