/**
 * WovenTex palette.
 *
 * Warm neutrals rather than the cold greys this started with — a textile
 * company's office should look like linen and walnut, not a wireframe. The
 * ground is deliberately low-contrast so that avatars, which are saturated and
 * ringed in near-white, stay the most legible thing on screen.
 */

export const PALETTE = {
  /* Ground */
  shell: "#CDC4B6",
  shellEdge: "#C0B6A6",
  oak: "#D8C3A2",
  oakLine: "#C6AC85",
  tile: "#E1DFD7",
  tileLine: "#CDC9BE",
  carpet: "#BEB3A4",
  carpetLine: "#B2A695",
  roomFloor: "#E4DED2",
  roomFloorLine: "#D5CCBC",

  /* Structure — three tones so walls read as solid volumes, not outlines */
  wall: "#3A342E",
  /** Lit top surface, seen from above. */
  wallTop: "#584E43",
  /** Shaded face dropping toward the viewer. */
  wallFace: "#332E29",
  /** Catch-light along the very top edge. */
  wallEdge: "#6B6053",
  shadow: "#2A2520",

  /* Entrance glazing */
  glass: "#AFC2C4",
  glassLight: "#D3E0DF",
  frame: "#4A423A",

  /* Furniture */
  walnut: "#7A5C42",
  walnutDark: "#5F4632",
  walnutLight: "#8E6E51",
  oatmeal: "#D9CFC0",
  oatmealDark: "#C3B7A4",
  stone: "#DCD8CF",
  slate: "#575E66",
  paper: "#F4F2ED",
  brass: "#B08D57",
  terracotta: "#B0704E",
  leaf: "#6E8C62",
  leafDark: "#4F6B4E",

  /* Type */
  label: "#8B8073",
  roomLabel: "#7E7365",
  nameText: "#2E2823",
  earshot: "#5A6B7A",
  doorHandle: "#B08D57",
} as const;

/** Book spines on the shelves. Muted enough not to shout. */
export const SPINE_COLORS = ["#8A5B4E", "#5B6E7A", "#7C7A54", "#6B5A78", "#A08356"] as const;
