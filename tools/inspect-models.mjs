/**
 * Measure models in a pack, so pieces can be chosen by proportion.
 *
 * A bought pack names its files `office_table_017.glb`, which says nothing
 * about whether that is a small side desk or a six-metre boardroom table. The
 * loader auto-fits everything into the footprint the floor plan declares, so
 * absolute size does not matter — but *aspect ratio* does. Fit a square table
 * into a long footprint and it shrinks to the narrow dimension and looks lost.
 *
 * This reports width, depth, height and aspect for each file, so a piece can be
 * matched to the footprint it has to fill.
 *
 *   node tools/inspect-models.mjs <dir> [prefix] [--aspect W:D] [--top N]
 *
 * Example — find a boardroom table for a 280x118 footprint:
 *   node tools/inspect-models.mjs ~/Downloads/Separate_assets_glb office_table --aspect 280:118
 */

import { NodeIO, getBounds } from "@gltf-transform/core";
import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";

const [dir, prefix = "", ...rest] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node tools/inspect-models.mjs <dir> [prefix] [--aspect W:D] [--top N]");
  process.exit(1);
}

const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const wanted = flag("aspect", null);
const top = Number(flag("top", 12));
/**
 * Treat Z as up rather than Y.
 *
 * glTF says Y-up, but packs exported from Blender or 3ds Max frequently ship
 * Z-up without a correcting rotation — which reads as every chair lying on its
 * side. Check one tall object: if its height lands in the Z column, pass this.
 */
const zUp = rest.includes("--zup");

const io = new NodeIO();

/**
 * World-space bounding box.
 *
 * Uses gltf-transform's own bounds, which composes every node's full matrix.
 * Reading accessor min/max and applying scale by hand ignores rotation, and
 * packs converted from Z-up carry a -90° X rotation — which silently reports
 * floor lamps as 60cm tall and wide.
 */
function measure(document) {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  if (!scene) return null;

  const { min, max } = getBounds(scene);
  if (!Number.isFinite(min[0]) || !Number.isFinite(max[0])) return null;

  const x = max[0] - min[0];
  const y = max[1] - min[1];
  const z = max[2] - min[2];

  return zUp ? { w: x, d: y, h: z } : { w: x, d: z, h: y };
}

function triangles(document) {
  let count = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const position = primitive.getAttribute("POSITION");
      count += (indices ? indices.getCount() : (position?.getCount() ?? 0)) / 3;
    }
  }
  return Math.round(count);
}

const files = (await readdir(dir))
  .filter((f) => f.endsWith(".glb") && f.toLowerCase().startsWith(prefix.toLowerCase()))
  .sort();

if (files.length === 0) {
  console.error(`No .glb files matching "${prefix}" in ${dir}`);
  process.exit(1);
}

const rows = [];
for (const file of files) {
  try {
    const document = await io.read(join(dir, file));
    const size = measure(document);
    if (!size) continue;

    // Footprint aspect, always long side first, so orientation does not matter.
    const long = Math.max(size.w, size.d);
    const short = Math.min(size.w, size.d);
    rows.push({
      file: basename(file),
      ...size,
      aspect: short > 0 ? long / short : 0,
      tris: triangles(document),
    });
  } catch {
    // Unreadable file — skip rather than abort the whole sweep.
  }
}

if (wanted) {
  const [a, b] = wanted.split(":").map(Number);
  const target = Math.max(a, b) / Math.min(a, b);
  rows.sort((x, y) => Math.abs(x.aspect - target) - Math.abs(y.aspect - target));
  console.log(`\nClosest to aspect ${wanted} (${target.toFixed(2)}:1), of ${rows.length} files\n`);
} else {
  rows.sort((x, y) => y.w * y.d - x.w * x.d);
  console.log(`\n${rows.length} files, largest footprint first${zUp ? " (Z-up)" : ""}\n`);
}

console.log("  file                        width   depth  height   aspect   tris");
for (const r of rows.slice(0, top)) {
  console.log(
    `  ${r.file.padEnd(26)} ${r.w.toFixed(2).padStart(6)}  ${r.d.toFixed(2).padStart(6)}  ` +
      `${r.h.toFixed(2).padStart(6)}   ${r.aspect.toFixed(2).padStart(5)}  ${String(r.tris).padStart(6)}`,
  );
}
console.log("");
