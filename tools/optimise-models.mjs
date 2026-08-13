/**
 * Turn a bought furniture pack into web-ready models.
 *
 * Two steps, both automatic:
 *
 *  1. Convert any .fbx to .glb. Most realistic packs ship FBX because they are
 *     aimed at Unity and Unreal, so this removes format from the buying
 *     decision entirely — buy whichever pack looks best.
 *  2. Shrink every .glb: resize textures, convert them to WebP, strip unused
 *     data, compress the meshes. Usually a 5–20x reduction with no visible
 *     difference at the size these render.
 *
 *   npm run models:optimise
 *
 * Safe to re-run: the untouched file is kept as .orig the first time, so
 * settings can be changed and reapplied without re-downloading anything.
 */

import { readdir, copyFile, access, rename, unlink } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const DIR = "web/public/models";

/** Textures render at a few hundred pixels on screen; 1024 is already generous. */
const MAX_TEXTURE = 1024;

const exists = (p) => access(p).then(() => true, () => false);

/* ── 1. FBX → glTF ────────────────────────────────────────────────── */

async function convertFbx() {
  const files = (await readdir(DIR)).filter((f) => extname(f).toLowerCase() === ".fbx");
  if (files.length === 0) return 0;

  let convert;
  try {
    convert = require("fbx2gltf");
  } catch {
    console.error("  fbx2gltf is not installed — run `npm install` at the repo root");
    return -1;
  }

  console.log(`Converting ${files.length} FBX file(s) to glTF\n`);
  let converted = 0;

  for (const file of files) {
    const source = join(DIR, file);
    const target = join(DIR, `${basename(file, extname(file))}.glb`);
    try {
      // fbx2gltf appends its own extension, so convert then move into place.
      const produced = await convert(source, target, ["--binary", "--pbr-metallic-roughness"]);
      if (produced !== target && (await exists(produced))) await rename(produced, target);
      // Keep the FBX out of the way; it is no longer needed at runtime.
      await rename(source, `${source}.orig`);
      console.log(`  ${file.padEnd(30)} → ${basename(target)}`);
      converted++;
    } catch (error) {
      console.error(`  ${file.padEnd(30)} FAILED — ${String(error).split("\n")[0]}`);
    }
  }
  console.log("");
  return converted;
}

/* ── 2. Shrink ────────────────────────────────────────────────────── */

async function optimise() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".glb"));
  if (files.length === 0) {
    console.log(`No models in ${DIR} yet — see the README there for what to buy.`);
    return 0;
  }

  console.log(`Optimising ${files.length} model(s)\n`);
  let failures = 0;

  for (const file of files) {
    const path = join(DIR, file);
    const original = `${path}.orig`;
    if (!(await exists(original))) await copyFile(path, original);

    try {
      await run(
        "npx",
        [
          "--yes",
          "@gltf-transform/cli",
          "optimize",
          original,
          path,
          "--texture-compress", "webp",
          "--texture-size", String(MAX_TEXTURE),
          "--compress", "meshopt",
          "--simplify", "false",
        ],
        { maxBuffer: 1024 * 1024 * 64 },
      );
      console.log(`  ${file.padEnd(30)} done`);
    } catch (error) {
      failures++;
      console.error(`  ${file.padEnd(30)} FAILED — ${String(error.message).split("\n")[0]}`);
    }
  }
  return failures;
}

/* ── Run ──────────────────────────────────────────────────────────── */

if (!(await exists(DIR))) {
  console.error(`${DIR} does not exist`);
  process.exit(1);
}

const converted = await convertFbx();
if (converted < 0) process.exit(1);

const failures = await optimise();

console.log(
  failures === 0
    ? "\nDone. Meshopt-compressed, so the loader decodes them with no extra files.\n" +
        "Next: name them in web/src/world/three/assets.ts\n"
    : `\n${failures} model(s) failed — their originals are untouched as .orig\n`,
);
process.exit(failures === 0 ? 0 : 1);
