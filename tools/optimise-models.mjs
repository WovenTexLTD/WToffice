/**
 * Shrink bought models to web weight.
 *
 * Packs ship at whatever size the author exported. This resizes textures,
 * converts them to WebP, strips unused data and compresses the meshes — usually
 * a 5–20x reduction with no visible difference at the size these render.
 *
 *   npm run models:optimise
 *
 * Rewrites every .glb in web/public/models in place, keeping a .orig copy the
 * first time so it can be re-run with different settings.
 */

import { readdir, copyFile, access } from "node:fs/promises";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const DIR = "web/public/models";

/** Textures render at a few hundred pixels on screen; 1024 is already generous. */
const MAX_TEXTURE = 1024;

const exists = async (p) => access(p).then(() => true, () => false);

const files = (await readdir(DIR)).filter((f) => f.endsWith(".glb"));
if (files.length === 0) {
  console.log(`No .glb files in ${DIR} yet — see the README there for what to buy.`);
  process.exit(0);
}

console.log(`Optimising ${files.length} model(s)\n`);
let failures = 0;

for (const file of files) {
  const path = join(DIR, file);
  const original = `${path}.orig`;

  // Keep the untouched file once, so this is safe to re-run.
  if (!(await exists(original))) await copyFile(path, original);

  try {
    const { stdout } = await run(
      "npx",
      [
        "--yes",
        "@gltf-transform/cli",
        "optimize",
        original,
        path,
        "--texture-compress",
        "webp",
        "--texture-size",
        String(MAX_TEXTURE),
        "--compress",
        "meshopt",
        "--simplify",
        "false",
      ],
      { maxBuffer: 1024 * 1024 * 32 },
    );
    const summary = stdout.trim().split("\n").slice(-1)[0] ?? "";
    console.log(`  ${basename(file).padEnd(28)} done  ${summary}`);
  } catch (error) {
    failures++;
    console.error(`  ${basename(file).padEnd(28)} FAILED`);
    console.error(`    ${String(error.message).split("\n")[0]}`);
  }
}

console.log(
  failures === 0
    ? "\nAll models optimised. Meshopt-compressed, so the loader decodes them without extra files.\n"
    : `\n${failures} model(s) failed — the originals are untouched as .glb.orig\n`,
);
process.exit(failures === 0 ? 0 : 1);
