/**
 * The faces, in a window that outlives the tab.
 *
 * Document Picture-in-Picture: a real browser window holding real DOM, which
 * stays on top while you work in another tab. It is what Meet and Teams use for
 * the same thing, and it is the only way to keep several faces visible at once
 * — the older `requestPictureInPicture` promotes a single `<video>` element and
 * nothing else.
 *
 * Audio deliberately does not come with it. Voice already plays through the
 * main page's audio elements with proximity volume applied, and giving these
 * videos sound would play everyone a second time, at full volume, from a window
 * that knows nothing about where anyone is standing.
 */

export interface Face {
  id: string;
  name: string;
  stream: MediaStream | null;
  speaking: boolean;
  muted: boolean;
  /** Your own face only, so it behaves the way a mirror does. */
  mirrored: boolean;
}

/** Not in lib.dom yet. */
interface PipApi {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

function api(): PipApi | null {
  const candidate = (window as unknown as { documentPictureInPicture?: PipApi })
    .documentPictureInPicture;
  return candidate ?? null;
}

/** Whether this browser can pop the faces out at all. Chrome and Edge can. */
export function facesWindowSupported(): boolean {
  return api() !== null;
}

const STYLE = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    height: 100vh;
    display: grid;
    gap: 6px;
    padding: 6px;
    background: #14150f;
    color: #f2efe9;
    font: 13px -apple-system, system-ui, sans-serif;
    align-content: center;
  }
  .face {
    position: relative;
    min-height: 0;
    border-radius: 10px;
    overflow: hidden;
    background: #23241d;
  }
  .face video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .face.speaking { outline: 2px solid #6fbf95; outline-offset: -2px; }
  .name {
    position: absolute;
    left: 6px;
    bottom: 6px;
    max-width: calc(100% - 12px);
    padding: 2px 7px;
    border-radius: 5px;
    background: rgba(12, 12, 10, 0.72);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name .off { color: #e0b76a; }
  .empty {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 16px;
    text-align: center;
    color: rgba(242, 239, 233, 0.45);
    font-size: 12px;
    line-height: 1.5;
  }
`;

export class FacesWindow {
  private win: Window | null = null;
  private tiles = new Map<string, { root: HTMLElement; video: HTMLVideoElement; name: HTMLElement }>();
  private faces: Face[] = [];

  constructor(private readonly onClose: () => void) {}

  get isOpen(): boolean {
    return this.win !== null && !this.win.closed;
  }

  /**
   * Must be called from a click.
   *
   * The browser will not open one of these without a recent user gesture, which
   * rules out opening it automatically when the tab is hidden — by then the
   * gesture has expired. Hence a button rather than something clever.
   */
  async open(): Promise<boolean> {
    const pip = api();
    if (!pip || this.isOpen) return this.isOpen;

    try {
      const win = await pip.requestWindow({ width: 320, height: 260 });
      const style = win.document.createElement("style");
      style.textContent = STYLE;
      win.document.head.appendChild(style);
      win.document.title = "Office — faces";

      // Closed by the person, not by us: put the interface back as it was.
      win.addEventListener("pagehide", () => {
        this.win = null;
        this.tiles.clear();
        this.onClose();
      });

      this.win = win;
      this.render(this.faces);
      return true;
    } catch {
      // Refused (no gesture, or the window was blocked). Not worth an error.
      return false;
    }
  }

  close(): void {
    this.win?.close();
    this.win = null;
    this.tiles.clear();
  }

  /** The faces to show. Safe to call whether or not the window is open. */
  render(faces: Face[]): void {
    this.faces = faces;
    const win = this.win;
    if (!win || win.closed) return;

    const body = win.document.body;

    if (faces.length === 0) {
      this.tiles.clear();
      body.style.gridTemplateColumns = "1fr";
      body.innerHTML =
        '<p class="empty">No cameras on right now.<br>This window keeps them in view while you work elsewhere.</p>';
      return;
    }

    const empty = body.querySelector(".empty");
    if (empty) empty.remove();

    // Squarish grid: one across for one face, two across beyond that.
    body.style.gridTemplateColumns = faces.length === 1 ? "1fr" : "1fr 1fr";

    const wanted = new Set(faces.map((f) => f.id));
    for (const [id, tile] of this.tiles) {
      if (wanted.has(id)) continue;
      tile.video.srcObject = null;
      tile.root.remove();
      this.tiles.delete(id);
    }

    for (const face of faces) {
      let tile = this.tiles.get(face.id);

      if (!tile) {
        const root = win.document.createElement("div");
        root.className = "face";

        const video = win.document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        // Always muted: voice arrives on the main page with proximity volume.
        video.muted = true;
        root.appendChild(video);

        const name = win.document.createElement("span");
        name.className = "name";
        root.appendChild(name);

        body.appendChild(root);
        tile = { root, video, name };
        this.tiles.set(face.id, tile);
      }

      // Rebinding srcObject restarts playback, so only do it on a real change.
      const current = tile.video.srcObject as MediaStream | null;
      if (current?.id !== face.stream?.id) tile.video.srcObject = face.stream;
      tile.video.style.transform = face.mirrored ? "scaleX(-1)" : "";

      tile.name.innerHTML = face.muted
        ? `${escapeHtml(face.name)} <span class="off">· muted</span>`
        : escapeHtml(face.name);
      tile.root.classList.toggle("speaking", face.speaking && !face.muted);
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
