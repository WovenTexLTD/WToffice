/**
 * Bought models, mapped onto the floor plan.
 *
 * Drop a .glb into `web/public/models/` and name it here. Everything else —
 * position, rotation, collision, proximity — already comes from the floor plan
 * and does not change.
 *
 * Models are auto-fitted to each kind's declared footprint, so a pack authored
 * in metres, centimetres or arbitrary units all work without hand-tuning. The
 * only things usually worth setting are `rotationY`, when a model faces the
 * wrong way, and `fitMode`, when a piece should fill its footprint rather than
 * fit inside it.
 *
 * Anything not listed keeps its built-in primitive, so a half-populated pack
 * still gives a complete room.
 */

import type { FurnitureKind } from "@wtoffice/shared";

export interface ModelSpec {
  /** Path under web/public — e.g. "/models/task-chair.glb". */
  url: string;
  /**
   * Extra Y rotation, in radians, applied before the floor plan's own rotation.
   * Packs disagree about which way is "front"; this is the usual fix.
   */
  rotationY?: number;
  /**
   * `contain` scales the model to sit inside the footprint, preserving its
   * proportions — right for almost everything. `cover` fills the footprint
   * instead, for things like rugs where the footprint is the point.
   */
  fitMode?: "contain" | "cover";
  /** Overrides auto-fit entirely when a pack is already correctly scaled. */
  scale?: number;
  /** Nudges the model up or down if its origin is not at its base. */
  offsetY?: number;
}

/**
 * The manifest. Empty until a pack lands — every kind currently falls back to
 * its primitive.
 *
 * Example once files exist:
 *
 *   desk:  { url: "/models/desk.glb" },
 *   chair: { url: "/models/task-chair.glb", rotationY: Math.PI },
 *   rug:   { url: "/models/rug.glb", fitMode: "cover" },
 */
export const MODELS: Partial<Record<FurnitureKind, ModelSpec>> = {};
