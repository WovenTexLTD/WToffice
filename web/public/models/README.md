# Furniture models

Drop `.glb` files here, name them in `web/src/world/three/assets.ts`, and they
replace the built-in shapes. Anything not listed keeps its primitive, so a
half-finished pack still gives a complete room.

Models are **auto-fitted** to the footprint each piece already declares in
`shared/src/floor.ts`, so a pack authored in metres, centimetres or arbitrary
units all work without hand-tuning. Origin at the centre, a corner or the top is
likewise handled — the loader measures the bounding box and sits the base on the
floor.

## What to buy

**Format — this is the one that matters**

- **glTF 2.0, `.glb`** (single file, textures embedded). FBX and OBJ are fine if
  you are willing to convert; `.blend`, `.max` and `.c4d` are not usable.
- Search terms that find the right thing: **"game ready"**, **"real-time"**,
  **"low poly PBR"**, **"glb"**, **"Unity"**, **"Unreal"**.
- Search terms that find the wrong thing: "high poly", "subdivision ready",
  "V-Ray", "Corona", "3ds Max scene", "for rendering". Those are built for
  offline rendering and arrive at 20–50 MB per object.

**Budget per piece**

| | target | hard ceiling |
|---|---|---|
| Triangles | under 8k | 20k |
| Texture size | 1024px | 2048px |
| File size | under 1 MB | 3 MB |

The whole pack wants to land under ~25 MB before compression. For comparison, a
single Poly Haven potted plant is 6.3 MB at its *smallest* setting — that is what
"built for offline rendering" costs, and why free photoscan libraries do not
work here.

**Licence** — check commercial use is permitted. "Royalty Free" or a standard
marketplace licence is fine; "Editorial use only" is not.

## The list

Roughly in order of how much each changes the room:

1. **Task chair** — used 12 times. The single highest-impact model.
2. **Desk** — 6 of them.
3. **Conference table** — the meeting room centrepiece.
4. **Potted plants** — 7 dotted around; two or three varieties is plenty.
5. **Sofa** and **armchair** — the lounge.
6. **Kitchen counter** and **bar stool**.
7. **Bookshelf**, **coffee table**, **bench**, **console table**.
8. **Whiteboard**, **floor lamp**, **rug**.

Monitors, laptops and mugs are modelled as part of the desk and are usually
included in office packs anyway.

**Style** — modern/contemporary commercial office, neutral palette. The room is
oak, linen and walnut; mid-century or industrial packs will sit fine, gaming
setups and Victorian furniture will not.

## Where

- **CGTrader** — largest selection, filter by glTF, sort by price
- **TurboSquid** — check the "Real-Time" filter
- **Sketchfab Store** — everything is already glTF; it also has free CC-BY
  models worth checking first
- **Kenney** (free, CC0) — stylised rather than realistic, but a good fallback
  for anything a paid pack misses

## After the files land

```bash
npm run models:optimise    # shrinks textures, compresses meshes
```

Then add entries to `assets.ts`:

```ts
export const MODELS: Partial<Record<FurnitureKind, ModelSpec>> = {
  chair: { url: "/models/task-chair.glb", rotationY: Math.PI },
  desk:  { url: "/models/desk.glb" },
  rug:   { url: "/models/rug.glb", fitMode: "cover" },
};
```

`rotationY` is the usual adjustment — packs disagree about which way is "front".
If a chair faces its own desk, add `Math.PI`.
