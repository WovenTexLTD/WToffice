"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ThreeScene as OfficeScene } from "@/world/three/ThreeScene";
import { OfficeClient, type ConnectionStatus } from "@/net/officeClient";
import { MediaEngine, type MicState, type PeerDiagnostic, type ShareState } from "@/media/MediaEngine";
import { VideoOverlay, type AvatarLook } from "@/video/VideoOverlay";
import { FacesWindow, facesWindowSupported, type Face } from "@/video/FacesWindow";
import { TasksBoard, type TasksState } from "@/components/TasksBoard";
import {
  type Floor,
  type NotionSource,
  type NotionTask,
  type TaskAlert,
  type PlayerState,
  type PresenceStatus,
} from "@wtoffice/shared";

/** Auto-away after this long with no keyboard or mouse. */
const IDLE_MS = 5 * 60_000;

/**
 * Where the office server is.
 *
 * There is no sensible default away from a developer's own machine. The server
 * is a long-lived WebSocket process with a database and a polling loop, so it
 * cannot run on the same serverless host as this page — it lives somewhere
 * else, and only NEXT_PUBLIC_WS_URL knows where.
 *
 * Falling back to localhost in a deployed build would point every visitor at
 * their own machine and fail silently, so this says so instead.
 */
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "";

function wsProblem(): string | null {
  if (typeof window === "undefined") return null;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

  if (!WS_URL) {
    return local
      ? null
      : "This site has no office server configured. Set NEXT_PUBLIC_WS_URL to the server's wss:// address and redeploy.";
  }
  // A browser refuses an insecure socket from a secure page, and the failure
  // looks identical to the server being down.
  if (window.location.protocol === "https:" && WS_URL.startsWith("ws://")) {
    return "The office server is configured over ws://, which a browser will not open from an https page. It needs wss://.";
  }
  return null;
}

const DEV_WS = "ws://localhost:3001";

/**
 * Where a remembered browser keeps its grant.
 *
 * The token, never the password — so the password itself is not sitting in a
 * browser store, and the grant lapses on its own.
 */
const DEVICE_STORE = "wtoffice.device";

interface Device {
  token: string;
  expiresAt: number;
}

function loadDevice(): Device | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_STORE);
    if (!raw) return null;
    const device = JSON.parse(raw) as Device;
    if (!device?.token || device.expiresAt <= Date.now()) {
      window.localStorage.removeItem(DEVICE_STORE);
      return null;
    }
    return device;
  } catch {
    return null;
  }
}

export function Office() {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(true);
  const [device, setDevice] = useState<Device | null>(null);
  const [ready, setReady] = useState(false);
  const [joined, setJoined] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);

  const [problem, setProblem] = useState<string | null>(null);

  // localStorage and location are not available while rendering on the server.
  useEffect(() => {
    setDevice(loadDevice());
    setProblem(wsProblem());
    setReady(true);
  }, []);

  if (!joined) {
    return (
      <Entry
        problem={problem}
        name={name}
        setName={setName}
        entryKey={key}
        setEntryKey={setKey}
        remember={remember}
        setRemember={setRemember}
        /* A live grant means the password field is not shown at all. */
        remembered={ready && device !== null}
        denied={denied}
        onJoin={() => {
          setDenied(null);
          setJoined(true);
        }}
      />
    );
  }

  return (
    <Stage
      name={name.trim()}
      auth={device ? { token: device.token } : { key, remember }}
      onDevice={(token, expiresAt) => {
        const next = { token, expiresAt };
        window.localStorage.setItem(DEVICE_STORE, JSON.stringify(next));
        setDevice(next);
        // The password has done its job and is not kept.
        setKey("");
      }}
      onLeave={() => setJoined(false)}
      onDenied={(reason) => {
        window.localStorage.removeItem(DEVICE_STORE);
        setDevice(null);
        setDenied(reason);
        setJoined(false);
      }}
    />
  );
}

/* ── Entry ─────────────────────────────────────────────────────── */

function Entry({
  name,
  setName,
  entryKey,
  setEntryKey,
  remember,
  setRemember,
  remembered,
  denied,
  problem,
  onJoin,
}: {
  name: string;
  setName: (v: string) => void;
  entryKey: string;
  setEntryKey: (v: string) => void;
  remember: boolean;
  setRemember: (v: boolean) => void;
  remembered: boolean;
  denied: string | null;
  problem: string | null;
  onJoin: () => void;
}) {
  const ready = name.trim().length > 0 && !problem;

  return (
    <div className="entry">
      <form
        className="entry-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onJoin();
        }}
      >
        <div>
          <p className="entry-kicker mono">WovenTex</p>
          <h1>The Office</h1>
        </div>
        <p>
          Walk with <strong>WASD</strong> or click where you want to go. You hear and see people
          as you get close to them, and the meeting rooms are sealed.
        </p>
        <p className="entry-note">Your browser will ask for microphone access when you walk in.</p>
        <div>
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Karim"
            maxLength={24}
            autoFocus
            autoComplete="off"
          />
        </div>
        {remembered ? (
          <p className="entry-note">This device is remembered — no password needed.</p>
        ) : (
          <>
            <div>
              <label htmlFor="office-key">Password</label>
              <input
                id="office-key"
                type="password"
                value={entryKey}
                onChange={(e) => setEntryKey(e.target.value)}
                placeholder="Leave blank if the office has none"
                autoComplete="current-password"
              />
            </div>
            <label className="entry-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember this device for 30 days
            </label>
          </>
        )}
        {problem && <p className="entry-denied">{problem}</p>}
        {denied && <p className="entry-denied">{denied}</p>}
        <button type="submit" disabled={!ready}>
          Walk in
        </button>
      </form>
    </div>
  );
}

/* ── Stage ─────────────────────────────────────────────────────── */

function Stage({
  name,
  auth,
  onDevice,
  onLeave,
  onDenied,
}: {
  name: string;
  auth: { key?: string; token?: string; remember?: boolean };
  onDevice: (token: string, expiresAt: number) => void;
  onLeave: () => void;
  onDenied: (reason: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const clientRef = useRef<OfficeClient | null>(null);
  const mediaRef = useRef<MediaEngine | null>(null);
  const overlayRef = useRef<VideoOverlay | null>(null);
  const facesRef = useRef<FacesWindow | null>(null);

  /** Peers whose video we can see. A ref because it updates at frame rate. */
  const visibleRef = useRef<Set<string>>(new Set());

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  /** The address that is not answering, shown once retrying is clearly futile. */
  const [deadUrl, setDeadUrl] = useState("");
  const [micState, setMicState] = useState<MicState>("idle");
  const [cameraState, setCameraState] = useState<ShareState>("off");
  const [screenState, setScreenState] = useState<ShareState>("off");
  const [muted, setMuted] = useState(false);

  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [selfId, setSelfId] = useState("");
  const [zone, setZone] = useState<string | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [tasks, setTasks] = useState<NotionTask[]>([]);
  const [taskSources, setTaskSources] = useState<NotionSource[]>([]);
  const [taskDb, setTaskDb] = useState("");
  const [taskStatuses, setTaskStatuses] = useState<string[]>([]);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [tasksState, setTasksState] = useState<TasksState>("loading");
  const [watching, setWatching] = useState<string[]>([]);
  /** Alerts still on screen. */
  const [alerts, setAlerts] = useState<TaskAlert[]>([]);
  /**
   * Alerts not yet dismissed.
   *
   * Kept whole rather than counted, because the board marks the database and
   * the individual task each one came from — and they clear only when clicked,
   * not because the board was opened.
   */
  const [unseen, setUnseen] = useState<TaskAlert[]>([]);
  /** Fires if a task request goes unanswered, so the board cannot spin forever. */
  const tasksTimer = useRef<number | null>(null);

  /** Bumped when remote tracks arrive or earshot membership changes. */
  const [mediaVersion, setMediaVersion] = useState(0);
  const bumpMedia = useCallback(() => setMediaVersion((v) => v + 1), []);

  /** Whether the faces have been popped out into their own window. */
  const [poppedOut, setPoppedOut] = useState(false);
  /** Chrome and Edge only; checked after mount so the server renders the same. */
  const [canPopOut, setCanPopOut] = useState(false);
  useEffect(() => setCanPopOut(facesWindowSupported()), []);

  const [broadcasting, setBroadcasting] = useState(false);
  const [knocks, setKnocks] = useState<{ id: number; name: string; doorId: string }[]>([]);
  const [diagnostics, setDiagnostics] = useState<PeerDiagnostic[] | null>(null);


  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let lastSpeaking = false;
    let lastMuted = false;
    const pushPresence = (speaking: boolean, isMuted: boolean) => {
      if (speaking === lastSpeaking && isMuted === lastMuted) return;
      lastSpeaking = speaking;
      lastMuted = isMuted;
      clientRef.current?.sendPresence(speaking, isMuted);
      sceneRef.current?.setSelfVoice(speaking, isMuted);
    };

    const media = new MediaEngine({
      onSignal: (to, data) => clientRef.current?.sendSignal(to, data),
      onSpeakingChange: (speaking) => pushPresence(speaking, media.isMuted()),
      onMicState: setMicState,
      onCameraState: setCameraState,
      onScreenState: setScreenState,
      onLocalMediaChange: (cameraOn, screenOn) =>
        clientRef.current?.sendMedia(cameraOn, screenOn),
      onRemoteMediaChange: bumpMedia,
    });
    mediaRef.current = media;

    const scene = new OfficeScene(host, {
      onPositionChange: (x, y) => clientRef.current?.sendPosition(x, y),
      onZoneChange: setZone,
      onGain: (peerId, gain) => media.setGain(peerId, gain),
      onSeeVideo: (peerId, visible) => {
        if (visible) visibleRef.current.add(peerId);
        else visibleRef.current.delete(peerId);
        // Only fires on a genuine change, so this re-render is rare.
        bumpMedia();
      },
      onSendVideo: (peerId, enabled) => media.setVideoEnabled(peerId, enabled),
      onDoorToggle: (doorId, open) => clientRef.current?.sendDoor(doorId, open),
      onKnock: (doorId) => clientRef.current?.sendKnock(doorId),
    });
    sceneRef.current = scene;

    // Reachable from the screenshot tool. Development only — it exists so the
    // office can be looked at, not driven.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __officeScene?: OfficeScene }).__officeScene = scene;
    }

    const client = new OfficeClient(WS_URL || DEV_WS, name, {
      onDenied,
      onDevice,
      onWelcome: (id, f, list, shutDoors) => {
        setSelfId(id);
        setFloor(f);
        setPlayers(list);
        scene.setFloor(f, id, list, shutDoors);
        // Peer up immediately; the microphone catches up on its own. Waiting on
        // the permission prompt means missing the offer sent while it is open.
        media.attach(id);
        media.syncPeers(list.map((p) => p.id));
        void media.ensureMic();
      },
      onDoors: (shut) => scene.setDoors(shut),
      onKnock: (doorId, knockerName) => {
        const id = Date.now() + Math.random();
        setKnocks((prev) => [...prev, { id, name: knockerName, doorId }]);
        window.setTimeout(() => setKnocks((prev) => prev.filter((k) => k.id !== id)), 8000);
      },
      onState: (list) => {
        setPlayers(list);
        scene.applyState(list);
        media.syncPeers(list.map((p) => p.id));
      },
      onJoined: (player) => scene.addPlayer(player),
      onLeft: (id) => {
        scene.removePlayer(id);
        visibleRef.current.delete(id);
      },
      onCorrect: (x, y) => scene.correctPosition(x, y),
      onStatus: (next, url) => {
        setStatus(next);
        if (next === "unreachable" && url) setDeadUrl(url);
      },
      onSignal: (from, data) => void media.handleSignal(from, data),

      onWatching: setWatching,

      /**
       * The backlog. Counted, but not thrown on screen as a stack of toasts —
       * you were away, and the board is where you go to see what happened.
       */
      onAlerts: (list) =>
        setUnseen((prev) => [...prev, ...list.filter((a) => !prev.some((p) => p.id === a.id))]),

      onAlert: (alert) => {
        setAlerts((prev) => [...prev, alert].slice(-4));
        setUnseen((prev) => (prev.some((p) => p.id === alert.id) ? prev : [...prev, alert]));
        // Each toast clears itself; a stack that only grows is a wall.
        window.setTimeout(() => {
          setAlerts((prev) => prev.filter((a) => a !== alert));
        }, 9000);
      },

      onTasks: (items, sources, database, statuses, configured, error) => {
        if (tasksTimer.current !== null) {
          window.clearTimeout(tasksTimer.current);
          tasksTimer.current = null;
        }
        setTasks(items);
        setTaskSources(sources);
        setTaskDb(database);
        setTaskStatuses(statuses);
        setTasksState(!configured ? "unconfigured" : error ? "error" : "ready");
      },
    }, auth);
    clientRef.current = client;

    // React double-invokes effects in development. Everything below the await
    // must check this, or the first pass keeps building a world nobody sees.
    let cancelled = false;

    void scene.init().then(() => {
      if (cancelled) return;
      // Created after init so it stacks above the canvas the scene appended.
      const overlay = new VideoOverlay(host);
      overlayRef.current = overlay;
      scene.setSurface(overlay);
      client.connect();
    });

    return () => {
      cancelled = true;
      client.disconnect();
      media.stop();
      scene.setSurface(null);
      overlayRef.current?.destroy();
      scene.destroy();
      sceneRef.current = null;
      clientRef.current = null;
      mediaRef.current = null;
      overlayRef.current = null;
    };
  }, [name, bumpMedia]);

  /* Bind each player's camera stream to their circle. */
  useEffect(() => {
    const overlay = overlayRef.current;
    const media = mediaRef.current;
    if (!overlay || !media) return;

    // Tile content: name, colour, and voice state. Updated when players change,
    // never per frame — the scene writes positions directly.
    const looks = new Map<string, AvatarLook>();
    for (const p of players) {
      looks.set(p.id, {
        name: p.id === selfId ? `${p.name} (you)` : p.name,
        color: p.color,
        speaking: p.speaking,
        muted: p.muted,
        status: p.status,
        avatar: p.avatar,
      });
    }
    overlay.setPlayers(looks);

    // The pop-out shows the same faces as the floor does, so it is filled from
    // the same pass rather than from a second set of rules that could drift.
    const faces: Face[] = [];
    let mine: Face | null = null;

    for (const p of players) {
      const isSelf = p.id === selfId;
      // The receiving transceiver always holds a track, black and muted, even
      // when nothing is being published — so gate on the peer's own flag.
      const stream = isSelf
        ? media.getLocalCameraStream()
        : p.cameraOn && visibleRef.current.has(p.id)
          ? media.getPeerVideo(p.id, "camera")
          : null;
      // Your own face is mirrored, the way a mirror behaves; everyone else's is not.
      overlay.setStream(p.id, stream, isSelf);

      if (!stream) continue;
      const face: Face = {
        id: p.id,
        name: isSelf ? "You" : p.name,
        stream,
        speaking: p.speaking,
        muted: p.muted,
        mirrored: isSelf,
      };
      if (isSelf) mine = face;
      else faces.push(face);
    }

    // Yourself last: the point of the window is the people you are talking to.
    if (mine) faces.push(mine);
    facesRef.current?.render(faces);
  }, [players, selfId, mediaVersion]);

  /**
   * Pop the faces into a window of their own.
   *
   * Has to be driven by this click: the browser refuses to open one without a
   * recent gesture, which is why it cannot simply appear when the tab is
   * hidden — by then there is no gesture left to spend.
   */
  const togglePopOut = useCallback(async () => {
    if (facesRef.current?.isOpen) {
      facesRef.current.close();
      setPoppedOut(false);
      return;
    }

    const faces = (facesRef.current ??= new FacesWindow(() => setPoppedOut(false)));
    const opened = await faces.open();
    setPoppedOut(opened);
    // A window opened between two binding passes has nothing in it yet; this
    // runs the pass that fills it.
    if (opened) bumpMedia();
  }, [bumpMedia]);

  /* The window belongs to the page; it must not outlive it. */
  useEffect(() => () => facesRef.current?.close(), []);

  /* ── Controls ──────────────────────────────────────────────────── */

  /**
   * Take a picture from disk, square it off and shrink it before sending.
   *
   * A phone photo is several megabytes, and this travels inside every state
   * broadcast — 128px covers the tile at any zoom this camera reaches, and
   * webp at that size lands in single-digit kilobytes.
   */
  const pickAvatar = useCallback(async (file: File) => {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Centre crop, so a portrait photo does not arrive squashed.
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      128,
      128,
    );
    bitmap.close();

    clientRef.current?.sendAvatar(canvas.toDataURL("image/webp", 0.82));
  }, []);

  /**
   * Ask for tasks, and give up if nothing comes back.
   *
   * A request that is never answered used to leave the board on "Loading…"
   * indefinitely — which is exactly what a server running code older than the
   * feature does, and it looks identical to Notion being slow.
   */
  const loadTasks = useCallback((database?: string) => {
    setTasksState("loading");
    clientRef.current?.requestTasks(database);

    if (tasksTimer.current !== null) window.clearTimeout(tasksTimer.current);
    tasksTimer.current = window.setTimeout(() => {
      tasksTimer.current = null;
      setTasksState((current) => (current === "loading" ? "error" : current));
    }, 12_000);
  }, []);

  // Fetched when the board is opened rather than at join: most sessions never
  // open it, and it is a round trip to Notion.
  useEffect(() => {
    if (tasksOpen) loadTasks(taskDb || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksOpen, loadTasks]);

  const toggleMute = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    const next = !media.isMuted();
    media.setMuted(next);
    setMuted(next);
    clientRef.current?.sendPresence(false, next);
    sceneRef.current?.setSelfVoice(false, next);
  }, []);

  const toggleCamera = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    void media.setCamera(media.getCameraState() !== "on");
  }, []);

  const toggleScreen = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    void media.setScreen(media.getScreenState() !== "on");
  }, []);

  const self = players.find((p) => p.id === selfId);

  // Near enough to the front doors to walk out of them. Measured from the
  // player the server reports rather than the one the scene is drawing, so the
  // prompt agrees with where everyone else thinks you are.
  const doorway = floor?.entrance;
  const atDoor =
    !!self &&
    !!doorway &&
    Math.hypot(
      self.x - (doorway.x + doorway.w / 2),
      self.y - (doorway.y + doorway.h / 2),
    ) < 190;

  const updatePresence = useCallback((status: PresenceStatus, note: string) => {
    clientRef.current?.sendStatus(status, note);
  }, []);

  /* Auto-away, and back again on the first sign of life. */
  useEffect(() => {
    if (!self) return;

    let lastActive = Date.now();
    let autoAway = false;

    const onActivity = () => {
      lastActive = Date.now();
      if (autoAway) {
        autoAway = false;
        clientRef.current?.sendStatus("available", "");
      }
    };

    const timer = window.setInterval(() => {
      if (autoAway || Date.now() - lastActive < IDLE_MS) return;
      // Never override a status the person chose deliberately.
      if (self.status !== "available") return;
      autoAway = true;
      clientRef.current?.sendStatus("away", self.note);
    }, 20_000);

    const events = ["mousemove", "keydown", "pointerdown", "wheel"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });

    return () => {
      window.clearInterval(timer);
      for (const e of events) window.removeEventListener(e, onActivity);
    };
  }, [self]);

  const toggleBroadcast = useCallback(() => {
    setBroadcasting((was) => {
      const next = !was;
      clientRef.current?.sendBroadcast(next);
      sceneRef.current?.setSelfBroadcast(next);
      return next;
    });
  }, []);

  /** Open the door someone is knocking on, and clear the notice. */
  const answerKnock = useCallback((knockId: number, doorId: string) => {
    clientRef.current?.sendDoor(doorId, true);
    setKnocks((prev) => prev.filter((k) => k.id !== knockId));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === "Space") {
        e.preventDefault();
        toggleMute();
        return;
      }
      if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        setDiagnostics((shown) => (shown ? null : (mediaRef.current?.getDiagnostics() ?? [])));
        return;
      }
      if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        setTasksOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMute]);

  // Keep the panel current while it is open.
  useEffect(() => {
    if (!diagnostics) return;
    const timer = window.setInterval(
      () => setDiagnostics(mediaRef.current?.getDiagnostics() ?? []),
      500,
    );
    return () => window.clearInterval(timer);
  }, [diagnostics === null]);

  const zoneName = useCallback(
    (id: string | null) => floor?.zones.find((z) => z.id === id)?.name ?? null,
    [floor],
  );

  /* Only shares from people you could hear — the same rule as voice. */
  const sharer = players.find((p) => p.screenOn && (p.id === selfId || visibleRef.current.has(p.id)));

  const statusLabel: Record<ConnectionStatus, string> = {
    connecting: "Connecting",
    online: `${players.length} in the office`,
    reconnecting: "Reconnecting",
    unreachable: "Can't reach the server",
    offline: "Offline",
  };

  const micLabel: Record<MicState, string> = {
    idle: "Starting mic",
    requesting: "Allow microphone…",
    live: muted ? "Muted" : "Mic live",
    denied: "Mic blocked",
    unavailable: "No microphone",
  };

  return (
    <div className="office">
      <div className="stage" ref={hostRef} />

      {sharer && (
        <SharePanel
          sharer={sharer}
          isSelf={sharer.id === selfId}
          getStream={() =>
            sharer.id === selfId
              ? (mediaRef.current?.getLocalScreenStream() ?? null)
              : (mediaRef.current?.getPeerVideo(sharer.id, "screen") ?? null)
          }
          version={mediaVersion}
        />
      )}

      {atDoor && (
        <button type="button" className="leave-prompt" onClick={onLeave}>
          Leave office
        </button>
      )}

      <div className="hud">
        <span className="hud-status mono">
          <span className={`dot ${status}`} />
          {statusLabel[status]}
        </span>

        <span className="hud-roster">
          {players.map((p) => (
            <span
              key={p.id}
              className={`chip${p.speaking && !p.muted ? " speaking" : ""}`}
              style={{ background: p.color }}
              title={p.name}
            >
              {p.name.slice(0, 2).toUpperCase()}
            </span>
          ))}
        </span>

        {zone && <span className="hud-zone mono">In {zoneName(zone)} · sealed</span>}

        <span className="hud-spacer" />

        <button
          type="button"
          className={`hud-btn${muted ? " warn" : ""}`}
          onClick={toggleMute}
          disabled={micState !== "live"}
          aria-pressed={muted}
        >
          <span className={`dot ${micState === "live" ? (muted ? "reconnecting" : "online") : "offline"}`} />
          {micLabel[micState]}
        </button>

        <label className="hud-btn hud-file">
          {self?.avatar ? "Change photo" : "Add photo"}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so choosing the same file twice still fires a change.
              e.target.value = "";
              if (file) void pickAvatar(file);
            }}
          />
        </label>

        <button
          type="button"
          className={`hud-btn${cameraState === "on" ? " active" : ""}`}
          onClick={toggleCamera}
          disabled={cameraState === "starting"}
          aria-pressed={cameraState === "on"}
        >
          {cameraState === "denied" ? "Camera blocked" : cameraState === "on" ? "Camera on" : "Camera"}
        </button>

        <button
          type="button"
          className={`hud-btn${screenState === "on" ? " active" : ""}`}
          onClick={toggleScreen}
          disabled={screenState === "starting"}
          aria-pressed={screenState === "on"}
        >
          {screenState === "on" ? "Stop sharing" : "Share screen"}
        </button>

        {canPopOut && (
          <button
            type="button"
            className={`hud-btn${poppedOut ? " active" : ""}`}
            onClick={() => void togglePopOut()}
            aria-pressed={poppedOut}
            title="Keep everyone's camera on screen while you work in another tab"
          >
            {poppedOut ? "Close faces" : "Pop out faces"}
          </button>
        )}

        <button
          type="button"
          className={`hud-btn${broadcasting ? " live" : ""}`}
          onClick={toggleBroadcast}
          disabled={micState !== "live"}
          aria-pressed={broadcasting}
          title="Everyone on the floor hears you, through walls and shut doors"
        >
          {broadcasting ? "Stop broadcast" : "Broadcast"}
        </button>

      </div>

      <button
        type="button"
        className={`tasks-open${tasksOpen ? " on" : ""}`}
        onClick={() => setTasksOpen((v) => !v)}
        title="Tasks"
        aria-label="Tasks"
        aria-pressed={tasksOpen}
      >
        {unseen.length > 0 && (
          <span className="tasks-badge">{unseen.length > 9 ? "9+" : unseen.length}</span>
        )}
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M4 6.5l2 2 3.5-3.5M4 13.5l2 2 3.5-3.5M4 20.5l2 2 3.5-3.5M13 6h7M13 13h7M13 20h7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {tasksOpen && (
        <TasksBoard
          tasks={tasks}
          sources={taskSources}
          database={taskDb}
          statuses={taskStatuses}
          state={tasksState}
          onPick={(db) => {
            setTaskDb(db);
            loadTasks(db);
          }}
          onCreate={(title, priority, due) =>
            clientRef.current?.createTask(title, priority, due, taskDb || undefined)
          }
          onRefresh={() => loadTasks(taskDb || undefined)}
          watching={watching}
          onWatch={(db, on) => clientRef.current?.setWatch(db, on)}
          onMove={(page, status) => {
            // Move the card the moment it is dropped rather than waiting for
            // Notion — a board that pauses on every drag feels broken. The
            // server answers with the real list, which corrects this if the
            // change was refused.
            setTasks((prev) => prev.map((t) => (t.id === page ? { ...t, status } : t)));
            clientRef.current?.moveTask(page, taskDb, status);
          }}
          unseen={unseen}
          onDismiss={(what) => {
            setUnseen((prev) =>
              prev.filter((a) =>
                what.page
                  ? a.id !== what.page
                  : what.database
                    ? a.database.replace(/-/g, "") !== what.database.replace(/-/g, "")
                    : false,
              ),
            );
            clientRef.current?.markAlertsSeen(what);
          }}
          onClose={() => setTasksOpen(false)}
        />
      )}

      {status === "unreachable" && (
        <div className="unreachable">
          <strong>Can&rsquo;t reach the office server.</strong>
          <span className="mono">{deadUrl}</span>
          <span>
            Nothing is answering there. The address may have changed, or the server may be
            stopped — check <code>NEXT_PUBLIC_WS_URL</code> and redeploy.
          </span>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map((alert) => (
            <a
              key={`${alert.url}-${alert.at}`}
              className="alert"
              href={alert.url}
              target="_blank"
              rel="noreferrer"
            >
              <span className="alert-source mono">{alert.source}</span>
              <span className="alert-title">{alert.title}</span>
            </a>
          ))}
        </div>
      )}

      {broadcasting && (
        <div className="broadcast-bar">
          Broadcasting to the whole floor — everyone hears you, through walls and shut doors.
        </div>
      )}

      {knocks.length > 0 && (
        <div className="knocks">
          {knocks.map((k) => (
            <div key={k.id} className="knock">
              <span>
                <strong>{k.name}</strong> is knocking
              </span>
              <button type="button" onClick={() => answerKnock(k.id, k.doorId)}>
                Let them in
              </button>
            </div>
          ))}
        </div>
      )}

      {diagnostics && (
        <div className="diag mono">
          <div className="diag-head">
            <strong>Media diagnostics</strong>
            <span>press I to close</span>
          </div>
          <div>
            you: {selfId || "—"} · mic {micState} · camera {cameraState} · screen {screenState}
          </div>
          {diagnostics.length === 0 ? (
            <div className="diag-empty">No peer connections.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>peer</th>
                  <th>conn</th>
                  <th>ice</th>
                  <th>gain</th>
                  <th>mid</th>
                  <th>direction</th>
                  <th>out</th>
                  <th>in</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.map((d) => (
                  <tr key={d.id}>
                    <td>{d.id}</td>
                    <td className={d.connection === "connected" ? "ok" : "bad"}>{d.connection}</td>
                    <td className={d.ice === "connected" || d.ice === "completed" ? "ok" : "bad"}>
                      {d.ice}
                    </td>
                    <td>{d.gain.toFixed(2)}</td>
                    <td className={d.mid === "-" ? "bad" : "ok"}>{d.mid}</td>
                    <td className={d.direction === "sendrecv" ? "ok" : "bad"}>{d.direction}</td>
                    <td className={d.outbound === "sending" ? "ok" : "bad"}>{d.outbound}</td>
                    <td className={d.inbound === "live" ? "ok" : "bad"}>{d.inbound}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {micState === "denied" && (
        <div className="banner">
          Microphone blocked. Allow it in your browser&apos;s site settings and reload — you can
          still walk around, but nobody will hear you.
        </div>
      )}
    </div>
  );
}

/* ── Screenshare viewer ────────────────────────────────────────── */

function SharePanel({
  sharer,
  isSelf,
  getStream,
  version,
}: {
  sharer: PlayerState;
  isSelf: boolean;
  getStream: () => MediaStream | null;
  version: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const stream = getStream();
    if (el.srcObject !== stream) {
      el.srcObject = stream;
      void el.play().catch(() => undefined);
    }
  }, [getStream, version]);

  return (
    <div className={`share-panel${expanded ? " expanded" : ""}`}>
      <div className="share-bar">
        <span className="share-who">
          {isSelf ? "You are sharing your screen" : `${sharer.name} is sharing`}
        </span>
        <button type="button" className="share-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Shrink" : "Expand"}
        </button>
      </div>
      {/* Muted: screenshare audio is not captured, and an unmuted element
          would fight the proximity audio path. */}
      <video ref={videoRef} autoPlay playsInline muted />
    </div>
  );
}
