/**
 * Make a bought pack browsable.
 *
 * Copies every model into web/public/catalogue and writes a manifest with each
 * one's real dimensions, so /catalogue can render the lot and you can pick
 * furniture by looking at it rather than by guessing from `office_table_017`.
 *
 *   node tools/build-catalogue.mjs ~/Downloads/Separate_assets_glb
 *
 * The copies are gitignored — this is a local browsing aid, not part of the
 * app. Only the handful of models named in assets.ts are committed.
 */

import { NodeIO, getBounds } from "@gltf-transform/core";
import { readdir, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { join, basename, extname } from "node:path";

const source = process.argv[2];
if (!source) {
  console.error("usage: node tools/build-catalogue.mjs <pack-dir>");
  process.exit(1);
}

const OUT = "web/public/catalogue";
const io = new NodeIO();

/**
 * The pack is Z-up and builds downward, so height is the Z extent. Reported the
 * same way the loader interprets it, or the numbers here would disagree with
 * what you see on screen.
 */
function measure(document) {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  if (!scene) return null;
  const { min, max } = getBounds(scene);
  if (!Number.isFinite(min[0])) return null;
  return {
    w: +(max[0] - min[0]).toFixed(2),
    d: +(max[1] - min[1]).toFixed(2),
    h: +(max[2] - min[2]).toFixed(2),
  };
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const files = (await readdir(source)).filter((f) => f.toLowerCase().endsWith(".glb")).sort();
console.log(`Cataloguing ${files.length} models\n`);

const items = [];
let done = 0;

for (const file of files) {
  const name = basename(file, extname(file));
  try {
    const document = await io.read(join(source, file));
    const size = measure(document);
    await copyFile(join(source, file), join(OUT, file));

    // Trailing digits are an index, not a category — office_table_017 belongs
    // with office_table.
    items.push({ name, category: name.replace(/_?\d+$/, "") || "other", ...size });
  } catch {
    // Unreadable file: skip rather than abort the whole catalogue.
  }

  if (++done % 200 === 0) console.log(`  ${done}/${files.length}`);
}

const categories = [...new Set(items.map((i) => i.category))].sort();
await writeFile(join(OUT, "manifest.json"), JSON.stringify({ items, categories }, null, 0));

console.log(`\n${items.length} models across ${categories.length} categories.`);
console.log("Open http://localhost:3000/catalogue\n");
