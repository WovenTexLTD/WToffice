"use client";

/**
 * Browse the furniture pack.
 *
 * A development aid, not part of the office. It exists because picking
 * furniture out of 1,741 files named `office_table_017.glb` is otherwise
 * guesswork — this renders each one so a piece can be chosen by looking at it.
 *
 * One shared WebGL renderer draws every thumbnail, blitted into a plain 2D
 * canvas per tile. Seventeen hundred live WebGL contexts is not a thing a
 * browser will do; one renderer reused is comfortable. Thumbnails are drawn
 * only when a tile scrolls into view, so opening the page costs almost nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

interface Item {
  name: string;
  category: string;
  w: number;
  d: number;
  h: number;
}

const THUMB = 260;

export function Catalogue() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/catalogue/manifest.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        setItems(data.items);
        setCategories(data.categories);
      })
      .catch(() =>
        setError("No catalogue yet. Run: node tools/build-catalogue.mjs ~/Downloads/Separate_assets_glb"),
      );
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (category === "all" || i.category === category) &&
        (q === "" || i.name.toLowerCase().includes(q)),
    );
  }, [items, category, query]);

  const copy = useCallback((name: string) => {
    void navigator.clipboard?.writeText(name);
    setCopied(name);
    window.setTimeout(() => setCopied((c) => (c === name ? null : c)), 1400);
  }, []);

  if (error) return <div className="cat-empty">{error}</div>;

  return (
    <div className="cat">
      <header className="cat-bar">
        <strong>Furniture pack</strong>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — chair, plant, table…"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories ({items.length})</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="cat-count">{shown.length} shown</span>
      </header>

      <p className="cat-hint">
        Click a model to copy its name, then tell me where it should go. Sizes are metres.
      </p>

      <div className="cat-grid">
        {shown.map((item) => (
          <Tile key={item.name} item={item} onPick={copy} copied={copied === item.name} />
        ))}
      </div>
    </div>
  );
}

/* ── Shared renderer ───────────────────────────────────────────────── */

let shared: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
} | null = null;

function getRenderer() {
  if (shared) return shared;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(THUMB, THUMB, false);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf0f4f8, 0x6b5c4a, 2.2));

  const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
  key.position.set(3, 5, 4);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xcfe0ee, 1.1);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  shared = { renderer, scene, camera };
  return shared;
}

/** Serialised so thumbnails queue rather than fighting over the one renderer. */
let queue: Promise<unknown> = Promise.resolve();

async function renderThumb(name: string, target: HTMLCanvasElement) {
  const { renderer, scene, camera } = getRenderer();
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

  const gltf = await new GLTFLoader().loadAsync(`/catalogue/${name}.glb`);
  const model = gltf.scene;

  // The pack is Z-up and builds downward; stand it up before framing it.
  const holder = new THREE.Group();
  holder.rotation.x = Math.PI / 2;
  holder.add(model);
  scene.add(holder);
  holder.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(holder);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(centre);

  // Frame it: three-quarter view, distance from the bounding sphere so tall and
  // wide pieces both fill the tile.
  const radius = Math.max(size.length() / 2, 0.001);
  const distance = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15;
  camera.position.set(centre.x + distance * 0.62, centre.y + distance * 0.55, centre.z + distance * 0.62);
  camera.lookAt(centre);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);

  const ctx = target.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, THUMB, THUMB);
    ctx.drawImage(renderer.domElement, 0, 0, THUMB, THUMB);
  }

  scene.remove(holder);
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const m = child.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
  });
}

/* ── Tile ──────────────────────────────────────────────────────────── */

function Tile({
  item,
  onPick,
  copied,
}: {
  item: Item;
  onPick: (name: string) => void;
  copied: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Only render what someone actually scrolls to.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || drawn.current) return;
        drawn.current = true;
        observer.disconnect();
        queue = queue.then(() => renderThumb(item.name, canvas).catch(() => undefined));
      },
      { rootMargin: "300px" },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [item.name]);

  return (
    <button type="button" className={`cat-tile${copied ? " copied" : ""}`} onClick={() => onPick(item.name)}>
      <canvas ref={canvasRef} width={THUMB} height={THUMB} />
      <span className="cat-name">{copied ? "copied" : item.name}</span>
      <span className="cat-dims">
        {item.w} × {item.d} × {item.h} m
      </span>
    </button>
  );
}
