/**
 * People, as DOM tiles above the 3D canvas.
 *
 * The whole visible person is here — video, initials fallback, nameplate,
 * speaking ring — rather than in the scene. From a near-overhead camera a
 * modelled body would be a shoulders-and-scalp blob; a tile facing the reader
 * is both clearer and the convention people already recognise.
 *
 * Kept in the DOM rather than as textures: sharper video, no per-frame texture
 * upload, and text that renders as text. The scene only supplies positions.
 *
 * Content is set from React when players change; position is written every
 * frame by the scene. Re-rendering a component tree at 60fps would be absurd,
 * so all the per-frame work here is direct style mutation.
 */

export interface AvatarLook {
  name: string;
  color: string;
  speaking: boolean;
  muted: boolean;
  status: string;
}

interface Slot {
  root: HTMLDivElement;
  frame: HTMLDivElement;
  video: HTMLVideoElement;
  initials: HTMLSpanElement;
  nameplate: HTMLSpanElement;
  stream: MediaStream | null;
  look: AvatarLook | null;
  placedThisFrame: boolean;
  lastSize: number;
}

export class VideoOverlay {
  private layer: HTMLDivElement;
  private slots = new Map<string, Slot>();

  constructor(host: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "video-layer";
    host.appendChild(this.layer);
  }

  destroy(): void {
    for (const id of [...this.slots.keys()]) this.removeSlot(id);
    this.layer.remove();
  }

  private ensure(id: string): Slot {
    const existing = this.slots.get(id);
    if (existing) return existing;

    const root = document.createElement("div");
    root.className = "avatar-tile";

    const frame = document.createElement("div");
    frame.className = "avatar-frame";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    // Always muted: voice arrives on a separate <audio> element with proximity
    // volume applied. An unmuted video element would play it a second time, at
    // full volume, defeating the entire proximity model.
    video.muted = true;
    frame.appendChild(video);

    const initials = document.createElement("span");
    initials.className = "avatar-initials";
    frame.appendChild(initials);

    const nameplate = document.createElement("span");
    nameplate.className = "avatar-name";

    root.appendChild(frame);
    root.appendChild(nameplate);
    this.layer.appendChild(root);

    const slot: Slot = {
      root,
      frame,
      video,
      initials,
      nameplate,
      stream: null,
      look: null,
      placedThisFrame: false,
      lastSize: -1,
    };
    this.slots.set(id, slot);
    return slot;
  }

  private removeSlot(id: string): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.video.srcObject = null;
    slot.root.remove();
    this.slots.delete(id);
  }

  /** Everyone currently in the room. Anyone absent is dropped. */
  setPlayers(looks: Map<string, AvatarLook>): void {
    for (const id of [...this.slots.keys()]) {
      if (!looks.has(id)) this.removeSlot(id);
    }
    for (const [id, look] of looks) this.applyLook(id, look);
  }

  private applyLook(id: string, look: AvatarLook): void {
    const slot = this.ensure(id);
    const prev = slot.look;
    slot.look = look;

    if (!prev || prev.name !== look.name) {
      slot.nameplate.textContent = look.name;
      slot.initials.textContent = look.name.slice(0, 2).toUpperCase();
    }
    if (!prev || prev.color !== look.color) {
      slot.frame.style.background = look.color;
    }
    if (!prev || prev.speaking !== look.speaking || prev.muted !== look.muted) {
      slot.root.classList.toggle("speaking", look.speaking && !look.muted);
      slot.root.classList.toggle("muted", look.muted);
    }
    if (!prev || prev.status !== look.status) {
      slot.root.dataset.status = look.status;
    }
  }

  /** Bind (or unbind) a camera stream. Rebinding srcObject restarts playback. */
  setStream(id: string, stream: MediaStream | null, mirrored: boolean): void {
    const slot = this.slots.get(id);
    if (!slot) return;

    slot.video.style.transform = mirrored ? "scaleX(-1)" : "";

    if (!stream) {
      if (slot.stream) {
        slot.stream = null;
        slot.video.srcObject = null;
        slot.root.classList.remove("has-video");
      }
      return;
    }
    if (slot.stream?.id === stream.id) return;

    slot.stream = stream;
    slot.video.srcObject = stream;
    slot.root.classList.add("has-video");
    void slot.video.play().catch(() => undefined);
  }

  /* ── Per-frame placement ───────────────────────────────────────── */

  beginFrame(): void {
    for (const slot of this.slots.values()) slot.placedThisFrame = false;
  }

  /** Position one tile, in CSS pixels relative to the canvas. */
  place(id: string, screenX: number, screenY: number, size: number): void {
    const slot = this.slots.get(id);
    if (!slot) return;

    slot.placedThisFrame = true;

    // Layout only changes on zoom, so avoid touching it every frame.
    if (Math.abs(size - slot.lastSize) > 0.5) {
      slot.lastSize = size;
      slot.root.style.width = `${size}px`;
      slot.frame.style.height = `${size}px`;
      slot.frame.style.borderRadius = `${Math.max(6, size * 0.2)}px`;
      slot.initials.style.fontSize = `${Math.max(9, size * 0.34)}px`;
      slot.nameplate.style.fontSize = `${Math.max(8, Math.min(13, size * 0.19))}px`;
    }

    slot.root.style.transform = `translate3d(${screenX - size / 2}px, ${screenY - size / 2}px, 0)`;
  }

  /** Hide anything the scene did not place — offscreen or departed. */
  endFrame(): void {
    for (const slot of this.slots.values()) {
      const visible = slot.placedThisFrame;
      const next = visible ? "visible" : "hidden";
      if (slot.root.style.visibility !== next) slot.root.style.visibility = next;
    }
  }
}
