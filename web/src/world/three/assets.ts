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
  /**
   * Which axis the pack treats as up.
   *
   * glTF says Y, but exports from Blender and 3ds Max frequently ship Z-up
   * without a correcting rotation — and a Z-up model loaded as Y-up lies on its
   * side. Check with `node tools/inspect-models.mjs <dir> <prefix> --zup`: if a
   * floor lamp only reads as 2m tall with the flag, the pack is Z-up.
   */
  upAxis?: "y" | "z";
  /**
   * Repaints every material on the model.
   *
   * The pack ships almost no texture imagery — 2.6 KB for 1,740 models — so its
   * colour lives in material values, which means overriding them actually
   * recolours the object rather than tinting a picture of one.
   */
  tint?: string;
}

/**
 * World units per metre.
 *
 * The pack is modelled in metres, and every piece gets this scale rather than
 * being auto-fitted to its footprint. Auto-fit would enlarge a 2m table to fill
 * a 3.3m footprint and make it 1.2m tall — pieces have to share one scale, or
 * the room reads as a dolls' house with a few giants in it.
 *
 * FURNITURE_SIZE in shared/src/types.ts is set from each model's real footprint
 * times this number, so collision matches what is drawn.
 */
const M = 85;

/**
 * The manifest.
 *
 * ithappy "Office 2" — every piece is Z-up, which is why each entry says so.
 * Anything not listed keeps its primitive, so `whiteboard` is still built in
 * code: nothing in the pack read as a wall-mounted board.
 *
 * To swap a piece, run the inspector over the pack and change one filename:
 *   node tools/inspect-models.mjs ~/Downloads/Separate_assets_glb sofa --zup
 */
/**
 * The ground the building sits on, tiled across the whole floor.
 *
 * Packs ship floors as a single square tile meant to be repeated, so this
 * carries the tile's size in metres alongside the usual spec. Area patches —
 * kitchen tile, studio oak — are drawn on top of it.
 */
export const GROUND: ModelSpec & { tileMetres: number } = {
  url: "/models/floor-tile.glb",
  scale: M,
  upAxis: "z",
  tileMetres: 4,
};

export const MODELS: Partial<Record<FurnitureKind, ModelSpec>> = {
  desk: { url: "/models/desk.glb", scale: M, upAxis: "z", tint: "#EDEAE4" },
  chair: { url: "/models/task-chair.glb", scale: M, upAxis: "z" },
  meetingTable: { url: "/models/meeting-table.glb", scale: M, upAxis: "z" },
  sofa: { url: "/models/sofa.glb", scale: M, upAxis: "z" },
  armchair: { url: "/models/armchair.glb", scale: M, upAxis: "z" },
  coffeeTable: { url: "/models/coffee-table.glb", scale: M, upAxis: "z" },
  stool: { url: "/models/stool.glb", scale: M, upAxis: "z" },
  counter: { url: "/models/counter.glb", scale: M, upAxis: "z" },
  plant: { url: "/models/plant.glb", scale: M, upAxis: "z" },
  rug: { url: "/models/rug.glb", scale: M, upAxis: "z" },
  shelf: { url: "/models/shelf.glb", scale: M, upAxis: "z" },
  lamp: { url: "/models/floor-lamp.glb", scale: M, upAxis: "z" },
  bench: { url: "/models/bench.glb", scale: M, upAxis: "z" },
  console: { url: "/models/console.glb", scale: M, upAxis: "z" },
  partition: { url: "/models/partition.glb", scale: M, upAxis: "z" },
  wallArt: { url: "/models/wall-art.glb", scale: M, upAxis: "z" },
  locker: { url: "/models/locker.glb", scale: M, upAxis: "z" },
  pillow: { url: "/models/pillow.glb", scale: M, upAxis: "z" },
  deskLamp: { url: "/models/desk-lamp.glb", scale: M, upAxis: "z" },
  tv: { url: "/models/tv.glb", scale: M, upAxis: "z" },
  printer: { url: "/models/printer.glb", scale: M, upAxis: "z" },
  waterCooler: { url: "/models/water-cooler.glb", scale: M, upAxis: "z" },
  roundTable: { url: "/models/round-table.glb", scale: M, upAxis: "z" },
  benchDesk: { url: "/models/bench-desk.glb", scale: M, upAxis: "z" },
  monitor: { url: "/models/monitor.glb", scale: M, upAxis: "z" },
  softCube: { url: "/models/soft-cube.glb", scale: M, upAxis: "z" },
  sideChair: { url: "/models/side-chair.glb", scale: M, upAxis: "z" },
  garmentRail: { url: "/models/garment-rail.glb", scale: M, upAxis: "z" },
  fabricRoll: { url: "/models/fabric-roll.glb", scale: M, upAxis: "z" },
  fabricStack: { url: "/models/fabric-stack.glb", scale: M, upAxis: "z" },
  crate: { url: "/models/crate.glb", scale: M, upAxis: "z" },
  instrument: { url: "/models/instrument.glb", scale: M, upAxis: "z" },
  // Twelve triangles and no texture, so a tint actually takes here — colour
  // multiplies a map where one exists, and this model has none to fight.
  officeRug: { url: "/models/office-rug.glb", scale: M, upAxis: "z", tint: "#2C4C86" },
  floorCushion: { url: "/models/floor-cushion.glb", scale: M, upAxis: "z" },
};
