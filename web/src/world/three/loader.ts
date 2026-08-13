/**
 * Model loading, with auto-fit.
 *
 * Bought packs never agree on units, origin or facing. Rather than hand-tuning
 * every piece, each model is measured on load and normalised: scaled to the
 * footprint the floor plan already declares, centred on it, and sat on the
 * floor. That is what makes "drop a .glb in and name it" actually true.
 *
 * Each URL is fetched once and cloned per instance, so twenty identical chairs
 * cost one download and share their geometry and materials.
 */

import * as THREE from "three";
import { FURNITURE_SIZE, type Furniture } from "@wtoffice/shared";
import { GROUND, MODELS, type ModelSpec } from "./assets";

const cache = new Map<string, Promise<THREE.Group>>();

async function fetchModel(url: string): Promise<THREE.Group> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/libs/meshopt_decoder.module.js"),
  ]);

  const loader = new GLTFLoader();
  // Meshopt is the compression the optimise script applies. It decodes from a
  // plain module, so unlike Draco it needs no decoder files served alongside.
  loader.setMeshoptDecoder(MeshoptDecoder);

  const gltf = await loader.loadAsync(url);
  gltf.scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return gltf.scene;
}

function loadOnce(url: string): Promise<THREE.Group> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetchModel(url);
    cache.set(url, pending);
  }
  return pending;
}

/**
 * Measure the model and normalise it into the footprint.
 *
 * Returned wrapped in a group so the caller can position and rotate it exactly
 * as it does a primitive.
 */
function normalise(source: THREE.Group, spec: ModelSpec, width: number, depth: number): THREE.Group {
  const model = source.clone(true);

  // Correct the up axis before measuring anything.
  //
  // glTF specifies Y-up, but packs exported from Blender or 3ds Max routinely
  // ship Z-up with no correcting rotation. Measured as-is, such a model reports
  // its height as depth — so it is fitted on its side.
  //
  // The sign matters and is worth checking rather than assuming: this pack
  // builds *downward*, with each model spanning Z −h to 0, so up is −Z and the
  // correction is +90°. Rotating the other way stands everything on its head.
  const oriented = new THREE.Group();
  if (spec.upAxis === "z") oriented.rotation.x = Math.PI / 2;
  oriented.add(model);
  oriented.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(oriented);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(centre);

  let scale = spec.scale ?? 1;
  if (spec.scale === undefined && size.x > 0 && size.z > 0) {
    const byWidth = width / size.x;
    const byDepth = depth / size.z;
    // `contain` keeps proportions inside the footprint; `cover` fills it.
    scale = spec.fitMode === "cover" ? Math.max(byWidth, byDepth) : Math.min(byWidth, byDepth);
  }

  const placed = new THREE.Group();
  placed.add(oriented);
  placed.scale.setScalar(scale);
  // Centre on the footprint horizontally, and sit the base on the floor —
  // packs put the origin at the centre, a corner or the top, inconsistently.
  placed.position.set(
    -centre.x * scale,
    -bounds.min.y * scale + (spec.offsetY ?? 0),
    -centre.z * scale,
  );

  // Two nested groups: the inner one carries the pack's own facing correction,
  // the outer stays free for the floor plan's rotation. Collapsing them would
  // mean the caller's rotation silently overwrites the spec's.
  const spin = new THREE.Group();
  spin.rotation.y = spec.rotationY ?? 0;
  spin.add(placed);

  const wrapper = new THREE.Group();
  wrapper.add(spin);
  return wrapper;
}

/**
 * The model for a piece, if one is configured.
 *
 * Resolves to null when there is no entry or the file fails to load, so the
 * caller keeps its primitive and a missing or broken asset never empties the
 * room.
 */
export async function modelFor(item: Furniture): Promise<THREE.Group | null> {
  const base = MODELS[item.kind];
  if (!base) return null;

  // A per-item override swaps the model but keeps the kind's scale and axis,
  // since variants come from the same pack.
  const spec = item.model ? { ...base, url: `/models/${item.model}.glb` } : base;

  const size = FURNITURE_SIZE[item.kind];
  const width = item.w ?? size.w;
  const depth = item.h ?? size.h;

  try {
    const source = await loadOnce(spec.url);
    return normalise(source, spec, width, depth);
  } catch (error) {
    console.warn(`[office] could not load ${spec.url}, keeping the built-in shape`, error);
    return null;
  }
}

/**
 * The ground, tiled to cover the floor exactly.
 *
 * Sized to divide the world evenly rather than overhanging it — a tile poking
 * out past the outer wall is visible from this camera, and a few percent of
 * stretch on a floor texture is not.
 */
export async function groundTiles(width: number, height: number): Promise<THREE.Group | null> {
  return tileFloor(GROUND.url, { x: 0, y: 0, w: width, h: height });
}

/**
 * Tile a floor model across a rectangle.
 *
 * Tiles are sized to divide the rectangle evenly rather than overhanging it —
 * an overhang crosses into the next room, and a few percent of stretch on a
 * floor texture is invisible.
 */
export async function tileFloor(
  url: string,
  area: { x: number; y: number; w: number; h: number },
): Promise<THREE.Group | null> {
  try {
    const source = await loadOnce(url);

    const oriented = new THREE.Group();
    if (GROUND.upAxis === "z") oriented.rotation.x = Math.PI / 2;
    oriented.add(source.clone(true));
    oriented.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(oriented);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    if (size.x <= 0 || size.z <= 0) return null;

    const nominal = GROUND.tileMetres * (GROUND.scale ?? 1);
    const cols = Math.max(1, Math.round(area.w / nominal));
    const rows = Math.max(1, Math.round(area.h / nominal));
    const tileW = area.w / cols;
    const tileH = area.h / rows;

    const group = new THREE.Group();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tile = oriented.clone(true);
        tile.scale.set(tileW / size.x, (tileW / size.x + tileH / size.z) / 2, tileH / size.z);
        tile.position.set(
          area.x + col * tileW + tileW / 2 - (bounds.min.x + size.x / 2) * (tileW / size.x),
          -bounds.min.y,
          area.y + row * tileH + tileH / 2 - (bounds.min.z + size.z / 2) * (tileH / size.z),
        );
        tile.traverse((child) => {
          if (child instanceof THREE.Mesh) child.receiveShadow = true;
        });
        group.add(tile);
      }
    }
    return group;
  } catch (error) {
    console.warn(`[office] could not tile ${url}, keeping the procedural floor`, error);
    return null;
  }
}

/** Whether any bought models are configured at all. */
export function hasModels(): boolean {
  return Object.keys(MODELS).length > 0;
}
