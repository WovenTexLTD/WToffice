/**
 * Load .env before anything reads it.
 *
 * Imported first by index.ts, because module bodies run in import order and
 * notion.ts reads process.env at the top of its own.
 *
 * Not node's --env-file flag: that only applies to the process it is passed to,
 * and `tsx watch` respawns its child without it. The first start had the
 * credentials and every reload after it silently did not — which looks exactly
 * like the token being wrong.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// server/src → server → repo root, whichever holds it.
for (const path of [resolve(here, "../../.env"), resolve(here, "../.env"), resolve(".env")]) {
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}
