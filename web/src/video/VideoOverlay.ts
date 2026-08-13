/**
 * Live video, rendered as DOM elements sitting on top of the Pixi canvas.
 *
 * Video deliberately does not go into the canvas. Drawing a <video> into WebGL
 * costs a texture upload per frame per peer, and the browser already composites
 * video on the GPU for free. So each face is a real <video> element positioned
 * with a transform, and the scene tells it where to go every frame.
 *
 * All writes here are direct DOM mutations rather than React state — this runs
 * at 60fps and re-rendering a component tree that often would be absurd.
 */

const CIRCLE_BORDER = 3;

interface Slot {
  root: HTMLDivElement;
  video: HTMLVideoElement;
  stream: MediaStream | null;
  placedThisFrame: boolean;
  lastDiameter: number;
}

export class VideoOverlay {
  private layer: HTMLDivElement;
  private slots = new Map<string, Slot>();

  constructor(private readonly host: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "video-layer";
    host.appendChild(this.layer);
  }

  destroy(): void {
    for (const id of [...this.slots.keys()]) this.removeSlot(id);
    this.layer.remove();
  }

  /* ── Streams ───────────────────────────────────────────────────── */

  /**
   * Bind (or unbind) a peer's camera stream. Safe to call repeatedly with the
   * same stream — rebinding srcObject restarts playback and flickers.
   */
  setStream(id: string, stream: MediaStream | null, mirrored: boolean): void {
    if (!stream) {
      this.removeSlot(id);
      return;
    }

    let slot = this.slots.get(id);
    if (!slot) slot = this.createSlot(id);

    slot.video.style.transform = mirrored ? "scaleX(-1)" : "";

    if (slot.stream?.id !== stream.id) {
      slot.stream = stream;
      slot.video.srcObject = stream;
      void slot.video.play().catch(() => undefined);
    }
  }

  private createSlot(id: string): Slot {
    const root = document.createElement("div");
    root.className = "video-circle";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    // Always muted: voice arrives on a separate <audio> element with proximity
    // volume applied. An unmuted video element would play it a second time, at
    // full volume, defeating the entire proximity model.
    video.muted = true;
    root.appendChild(video);

    this.layer.appendChild(root);
    const slot: Slot = { root, video, stream: null, placedThisFrame: false, lastDiameter: -1 };
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

  /* ── Per-frame placement ───────────────────────────────────────── */

  beginFrame(): void {
    for (const slot of this.slots.values()) slot.placedThisFrame = false;
  }

  /** Position one circle, in CSS pixels relative to the canvas. */
  place(id: string, screenX: number, screenY: number, diameter: number): void {
    const slot = this.slots.get(id);
    if (!slot) return;

    slot.placedThisFrame = true;

    // Size changes only on zoom, so avoid touching layout every frame.
    if (Math.abs(diameter - slot.lastDiameter) > 0.5) {
      slot.lastDiameter = diameter;
      slot.root.style.width = `${diameter}px`;
      slot.root.style.height = `${diameter}px`;
      slot.root.style.borderWidth = `${Math.max(2, CIRCLE_BORDER * (diameter / 44))}px`;
    }

    const half = diameter / 2;
    slot.root.style.transform = `translate3d(${screenX - half}px, ${screenY - half}px, 0)`;
  }

  /** Hide anything the scene did not place — offscreen or departed. */
  endFrame(): void {
    for (const slot of this.slots.values()) {
      const visible = slot.placedThisFrame;
      if (slot.root.style.visibility !== (visible ? "visible" : "hidden")) {
        slot.root.style.visibility = visible ? "visible" : "hidden";
      }
    }
  }
}
