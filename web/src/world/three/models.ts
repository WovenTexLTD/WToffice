/**
 * Furniture, as real geometry.
 *
 * Built from primitives rather than loaded as meshes: no bundle weight, no
 * licences, instant start-up, and every piece is authored in code next to the
 * floor plan it belongs to. A desk is a top on four legs with a monitor and a
 * laptop on it — the things are actually there, so lighting and shadows do the
 * work that hand-drawn shading used to.
 *
 * `loadModel` is the seam for scanned glTF later. Anywhere a real model is worth
 * the download, swap the builder for a loader and nothing else changes.
 */

import * as THREE from "three";
import { FURNITURE_SIZE, type Furniture, type FurnitureKind } from "@wtoffice/shared";

/* ── Materials ────────────────────────────────────────────────────── */

const mat = (color: string, roughness = 0.7, metalness = 0.0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const M = {
  walnut: mat("#6B4A32", 0.62),
  walnutDark: mat("#4A3223", 0.7),
  oakTop: mat("#A97C4E", 0.55),
  fabric: mat("#C9BCA8", 0.95),
  fabricDark: mat("#A2937E", 0.95),
  metal: mat("#9AA0A6", 0.35, 0.85),
  darkMetal: mat("#3C4046", 0.4, 0.7),
  screen: new THREE.MeshStandardMaterial({
    color: "#1B2730",
    roughness: 0.18,
    metalness: 0.1,
    emissive: new THREE.Color("#25506B"),
    emissiveIntensity: 0.55,
  }),
  keyboard: mat("#2C3238", 0.8),
  stone: mat("#D6D2C8", 0.4),
  paper: mat("#F2F0EA", 0.9),
  brass: mat("#B08D57", 0.35, 0.8),
  terracotta: mat("#A8613F", 0.85),
  soil: mat("#3B2E24", 1),
  leaf: mat("#5C7D52", 0.85),
  leafDark: mat("#44603D", 0.85),
  rugPile: mat("#B4A796", 1),
  rugTrim: mat("#9C6046", 1),
  glassWarm: new THREE.MeshStandardMaterial({
    color: "#F6E2B8",
    emissive: new THREE.Color("#F6E2B8"),
    emissiveIntensity: 1.4,
    roughness: 0.3,
  }),
} as const;

const SPINES = ["#7A4E43", "#4F6070", "#6E6C4A", "#5E4E6A", "#8E7249"].map((c) => mat(c, 0.85));

/* ── Helpers ──────────────────────────────────────────────────────── */

function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(
  rTop: number,
  rBottom: number,
  h: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  segments = 16,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Four legs at the corners of a footprint. */
function legs(g: THREE.Group, w: number, d: number, height: number, inset = 6): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(
        box(5, height, 5, M.darkMetal, sx * (w / 2 - inset), height / 2, sz * (d / 2 - inset)),
      );
    }
  }
}

/** An open laptop: base, keyboard, and a lid tilted back with a lit screen. */
function laptop(x: number, z: number, rotation = 0): THREE.Group {
  const g = new THREE.Group();
  g.add(box(46, 2.4, 32, M.metal, 0, 1.2, 0));
  g.add(box(38, 0.8, 22, M.keyboard, 0, 2.6, 2));

  const lid = new THREE.Group();
  lid.add(box(46, 30, 2, M.metal, 0, 15, 0));
  lid.add(box(41, 25, 0.6, M.screen, 0, 15, 1.2));
  lid.position.set(0, 2, -15);
  lid.rotation.x = -0.36; // Hinged back, the way a laptop actually sits.
  g.add(lid);

  g.position.set(x, 0, z);
  g.rotation.y = rotation;
  return g;
}

function monitor(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(9, 11, 1.6, M.darkMetal, 0, 0.8, 0, 12));
  g.add(box(3.5, 22, 3.5, M.darkMetal, 0, 11, 0));
  g.add(box(60, 34, 2.2, M.darkMetal, 0, 34, 0));
  g.add(box(56, 30, 0.6, M.screen, 0, 34, 1.4));
  g.position.set(x, 0, z);
  return g;
}

function mug(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(4.2, 3.6, 9, M.paper, 0, 4.5, 0, 12));
  g.position.set(x, 0, z);
  return g;
}

/* ── Builders ─────────────────────────────────────────────────────── */

type Build = (w: number, d: number) => THREE.Group;

const BUILD: Partial<Record<FurnitureKind, Build>> = {
  desk(w, d) {
    const g = new THREE.Group();
    const top = 62; // 75cm
    g.add(box(w, 4, d, M.oakTop, 0, top, 0));
    legs(g, w, d, top);
    g.add(box(w - 16, 12, 3, M.darkMetal, 0, top - 12, -d / 2 + 8));
    const mon = monitor(-14, -12);
    mon.position.y = top + 2;
    g.add(mon);
    const lap = laptop(24, 6, -0.3);
    lap.position.y = top + 2;
    g.add(lap);
    const cup = mug(-w / 2 + 18, d / 2 - 12);
    cup.position.y = top + 2;
    g.add(cup);
    return g;
  },

  chair(w, d) {
    const g = new THREE.Group();
    const seat = 37; // 45cm
    g.add(box(w - 4, 5, d - 4, M.fabric, 0, seat, 0));
    g.add(box(w - 6, 42, 4, M.fabricDark, 0, seat + 23, -d / 2 + 3));
    g.add(cyl(2.5, 2.5, seat, M.darkMetal, 0, seat / 2, 0, 10));
    // A five-star base, which is most of what makes an office chair legible.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = box(3.5, 2.5, 15, M.darkMetal, Math.sin(a) * 7, 3, Math.cos(a) * 7);
      arm.rotation.y = a;
      arm.position.set(Math.sin(a) * 8, 3, Math.cos(a) * 8);
      g.add(arm);
    }
    return g;
  },

  sofa(w, d) {
    const g = new THREE.Group();
    g.add(box(w, 18, d, M.fabricDark, 0, 26, 0));
    for (const sx of [-1, 1]) {
      g.add(box(w / 2 - 6, 14, d - 18, M.fabric, (sx * w) / 4, 42, 6));
    }
    g.add(box(w, 44, 15, M.fabric, 0, 56, -d / 2 + 7));
    for (const sx of [-1, 1]) {
      g.add(box(15, 34, d, M.fabric, sx * (w / 2 - 7), 44, 0));
    }
    legs(g, w, d, 17, 10);
    return g;
  },

  armchair(w, d) {
    const g = new THREE.Group();
    g.add(box(w, 18, d, M.fabricDark, 0, 26, 0));
    g.add(box(w - 22, 14, d - 18, M.fabric, 0, 42, 5));
    g.add(box(w, 42, 12, M.fabric, 0, 54, -d / 2 + 6));
    for (const sx of [-1, 1]) {
      g.add(box(12, 32, d, M.fabric, sx * (w / 2 - 6), 43, 0));
    }
    legs(g, w, d, 17, 9);
    return g;
  },

  meetingTable(w, d) {
    const g = new THREE.Group();
    const top = 62; // 75cm
    g.add(box(w, 5, d, M.walnut, 0, top, 0));
    for (const sx of [-1, 1]) {
      g.add(box(14, top, d - 30, M.walnutDark, (sx * w) / 3, top / 2, 0));
    }
    g.add(box(w / 2, 8, 10, M.walnutDark, 0, 10, 0));
    // Dressing, so it reads as a room in use.
    const l = laptop(-w / 4, 0, 0.2);
    l.position.y = top + 2.5;
    g.add(l);
    for (const x of [w / 5, w / 3.2]) {
      const cup = mug(x, 12);
      cup.position.y = top + 2.5;
      g.add(cup);
    }
    return g;
  },

  coffeeTable(w, d) {
    const g = new THREE.Group();
    g.add(box(w, 4, d, M.walnut, 0, 33, 0));
    legs(g, w, d, 33, 7);
    g.add(box(22, 3, 28, M.paper, 6, 36, 0));
    return g;
  },

  stool(w) {
    const g = new THREE.Group();
    g.add(cyl(w / 2, w / 2 - 2, 5, M.fabric, 0, 54, 0));
    g.add(cyl(2.4, 2.4, 54, M.metal, 0, 27, 0, 12));
    g.add(cyl(w / 2 - 3, w / 2 - 3, 2, M.darkMetal, 0, 1, 0, 16));
    return g;
  },

  counter(w, d) {
    const g = new THREE.Group();
    g.add(box(w, 75, d, M.paper, 0, 37.5, 0)); // 90cm counter height
    g.add(box(w + 3, 5, d + 2, M.stone, 0, 78, 0));
    // Sink and tap.
    g.add(box(52, 4, d - 22, M.metal, -w / 4, 79, 0));
    g.add(cyl(1.6, 1.6, 20, M.metal, -w / 4, 90, -d / 2 + 8, 10));
    // Hob.
    for (const dx of [-14, 14]) {
      for (const dz of [-8, 8]) g.add(cyl(6, 6, 1.2, M.darkMetal, w / 4 + dx, 81, dz, 14));
    }
    // Cupboard seams.
    for (const x of [-w / 4, 0, w / 4]) g.add(box(1, 62, 1, M.walnutDark, x, 38, d / 2));
    return g;
  },

  plant(w) {
    const g = new THREE.Group();
    const r = w / 2;
    g.add(cyl(r * 0.82, r * 0.62, 26, M.terracotta, 0, 13, 0, 18));
    g.add(cyl(r * 0.74, r * 0.74, 3, M.soil, 0, 26, 0, 18));
    // Foliage as a few overlapping low-poly spheres; from a distance the
    // silhouette is what sells it, not leaf detail.
    const blobs: [number, number, number, THREE.Material][] = [
      [0, 46, r * 0.92, M.leaf],
      [-r * 0.5, 38, r * 0.62, M.leafDark],
      [r * 0.48, 42, r * 0.58, M.leafDark],
      [0, 62, r * 0.58, M.leaf],
    ];
    for (const [x, y, radius, material] of blobs) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), material);
      blob.position.set(x, y, 0);
      blob.castShadow = true;
      g.add(blob);
    }
    return g;
  },

  rug(w, d) {
    const g = new THREE.Group();
    const rug = box(w, 1.2, d, M.rugPile, 0, 0.6, 0);
    rug.castShadow = false;
    g.add(rug);
    const trim = box(w - 22, 1.4, d - 22, M.rugTrim, 0, 0.8, 0);
    trim.castShadow = false;
    g.add(trim);
    const inner = box(w - 30, 1.6, d - 30, M.rugPile, 0, 1, 0);
    inner.castShadow = false;
    g.add(inner);
    return g;
  },

  shelf(w, d) {
    const g = new THREE.Group();
    const h = 150; // 180cm
    g.add(box(w, h, d, M.walnutDark, 0, h / 2, 0));
    for (const y of [42, 84, 122]) g.add(box(w - 4, 2, d + 1, M.walnut, 0, y, 0));
    let x = -w / 2 + 8;
    let i = 0;
    while (x < w / 2 - 10) {
      const bw = 5 + ((i * 7) % 7);
      const bh = 16 + ((i * 5) % 7);
      g.add(box(bw, bh, d - 8, SPINES[i % SPINES.length], x, 44 + bh / 2, 0));
      g.add(box(bw, bh - 3, d - 8, SPINES[(i + 2) % SPINES.length], x, 86 + bh / 2, 0));
      x += bw + 2;
      i++;
    }
    return g;
  },

  whiteboard(w) {
    const g = new THREE.Group();
    g.add(box(w, 100, 3, M.paper, 0, 133, 0));
    g.add(box(w + 4, 4, 5, M.brass, 0, 83, 0));
    g.add(box(w + 4, 4, 5, M.brass, 0, 183, 0));
    for (const sx of [-1, 1]) g.add(box(4, 83, 4, M.darkMetal, sx * (w / 2 - 8), 41, 0));
    return g;
  },

  lamp(w) {
    const g = new THREE.Group();
    g.add(cyl(w / 2, w / 2, 2, M.darkMetal, 0, 1, 0, 16));
    g.add(cyl(1.6, 1.6, 118, M.brass, 0, 59, 0, 10));
    g.add(cyl(17, 11, 20, M.glassWarm, 0, 128, 0, 18));
    return g;
  },

  bench(w, d) {
    const g = new THREE.Group();
    g.add(box(w, 5, d, M.oakTop, 0, 37, 0));
    for (const x of [-w / 3, 0, w / 3]) g.add(box(2, 5.4, d, M.walnutDark, x, 37, 0));
    for (const sx of [-1, 1]) g.add(box(6, 37, d - 6, M.walnutDark, sx * (w / 2 - 8), 18.5, 0));
    return g;
  },

  console(w, d) {
    const g = new THREE.Group();
    g.add(box(w, 5, d, M.walnut, 0, 67, 0));
    g.add(box(w - 12, 30, d - 6, M.walnutDark, 0, 48, 0));
    legs(g, w, d, 48, 8);
    const p = mug(w / 4, 0);
    p.position.y = 69;
    g.add(p);
    return g;
  },
};

/** Stand-in for kinds with no hand-built primitive. */
const genericBlock: Build = (w, d) => {
  const g = new THREE.Group();
  g.add(box(w, 40, d, M.fabricDark, 0, 20, 0));
  return g;
};

/** Builds one piece, positioned and rotated on the floor plan. */
export function buildFurniture(item: Furniture): THREE.Group {
  const size = FURNITURE_SIZE[item.kind];
  const w = item.w ?? size.w;
  const d = item.h ?? size.h;

  // A plain block stands in for any kind without a hand-built shape. These are
  // only ever placeholders — every kind in the manifest is replaced by its real
  // model a moment later — so a generic fallback is enough, and it means adding
  // a furniture kind costs one line rather than a new primitive.
  const build = BUILD[item.kind] ?? genericBlock;
  const group = build(w, d);
  // World Y is depth on the floor plane; Three's Y is up.
  // Elevation lifts things that sit on other things; the loaded model copies
  // this position, so it applies to both the placeholder and the real mesh.
  group.position.set(item.x, item.elevation ?? 0, item.y);
  group.rotation.y = -(item.rotation ?? 0);
  return group;
}

/**
 * Seam for real models.
 *
 * Where a scanned or sculpted mesh is worth its download, load the glTF here
 * and return it in place of the built group — position, rotation and collision
 * all stay exactly as they are.
 */
export async function loadModel(url: string): Promise<THREE.Group> {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return gltf.scene;
}
