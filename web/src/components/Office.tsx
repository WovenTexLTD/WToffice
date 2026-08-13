"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ThreeScene as OfficeScene } from "@/world/three/ThreeScene";
import { OfficeClient, type ConnectionStatus } from "@/net/officeClient";
import { MediaEngine, type MicState, type PeerDiagnostic, type ShareState } from "@/media/MediaEngine";
import { VideoOverlay, type AvatarLook } from "@/video/VideoOverlay";
import { SidePanel, type PanelTab } from "@/components/SidePanel";
import {
  TEAM_CHANNEL,
  pointInRect,
  type ChatMessage,
  type Floor,
  type PlayerState,
  type PresenceStatus,
} from "@wtoffice/shared";

/** Auto-away after this long with no keyboard or mouse. */
const IDLE_MS = 5 * 60_000;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";

export function Office() {
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);

  if (!joined) {
    return <Entry name={name} setName={setName} onJoin={() => setJoined(true)} />;
  }
  return <Stage name={name.trim()} />;
}

/* ── Entry ─────────────────────────────────────────────────────── */

function Entry({
  name,
  setName,
  onJoin,
}: {
  name: string;
  setName: (v: string) => void;
  onJoin: () => void;
}) {
  const ready = name.trim().length > 0;

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
        <button type="submit" disabled={!ready}>
          Walk in
        </button>
      </form>
    </div>
  );
}

/* ── Stage ─────────────────────────────────────────────────────── */

function Stage({ name }: { name: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const clientRef = useRef<OfficeClient | null>(null);
  const mediaRef = useRef<MediaEngine | null>(null);
  const overlayRef = useRef<VideoOverlay | null>(null);

  /** Peers whose video we can see. A ref because it updates at frame rate. */
  const visibleRef = useRef<Set<string>>(new Set());

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [micState, setMicState] = useState<MicState>("idle");
  const [cameraState, setCameraState] = useState<ShareState>("off");
  const [screenState, setScreenState] = useState<ShareState>("off");
  const [muted, setMuted] = useState(false);

  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [selfId, setSelfId] = useState("");
  const [zone, setZone] = useState<string | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);

  /** Bumped when remote tracks arrive or earshot membership changes. */
  const [mediaVersion, setMediaVersion] = useState(0);
  const bumpMedia = useCallback(() => setMediaVersion((v) => v + 1), []);

  const [broadcasting, setBroadcasting] = useState(false);
  const [knocks, setKnocks] = useState<{ id: number; name: string; doorId: string }[]>([]);
  const [diagnostics, setDiagnostics] = useState<PeerDiagnostic[] | null>(null);

  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("chat");
  const [activeChannel, setActiveChannel] = useState(TEAM_CHANNEL);
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});

  /** Channels we have already asked the server for. */
  const loadedRef = useRef<Set<string>>(new Set());
  /** Read by socket handlers, which close over their first render otherwise. */
  const viewRef = useRef({ open: true, tab: "chat" as PanelTab, channel: TEAM_CHANNEL, identity: "" });

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

    const client = new OfficeClient(WS_URL, name, {
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
      onStatus: setStatus,
      onSignal: (from, data) => void media.handleSignal(from, data),

      onChat: (message) => {
        setThreads((prev) => ({
          ...prev,
          [message.channel]: [...(prev[message.channel] ?? []), message],
        }));

        // Unread only counts what you are not already looking at.
        const view = viewRef.current;
        const watching = view.open && view.tab === "chat" && view.channel === message.channel;
        if (!watching && message.identity !== view.identity) {
          setUnread((prev) => ({ ...prev, [message.channel]: (prev[message.channel] ?? 0) + 1 }));
        }
      },

      onHistory: (channel, page, more) => {
        setThreads((prev) => {
          const existing = prev[channel] ?? [];
          // A page whose newest message predates what we hold is older history
          // being paged in; anything else replaces.
          const isOlder =
            existing.length > 0 && page.length > 0 && page[page.length - 1].id < existing[0].id;
          return { ...prev, [channel]: isOlder ? [...page, ...existing] : page };
        });
        setHasMore((prev) => ({ ...prev, [channel]: more }));
      },
    });
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
      });
    }
    overlay.setPlayers(looks);

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
    }
  }, [players, selfId, mediaVersion]);

  /* ── Controls ──────────────────────────────────────────────────── */

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

  /* ── Chat plumbing ─────────────────────────────────────────────── */

  const self = players.find((p) => p.id === selfId);

  // Socket handlers are created once, so they read the current view from a ref.
  useEffect(() => {
    viewRef.current = {
      open: panelOpen,
      tab: panelTab,
      channel: activeChannel,
      identity: self?.identity ?? "",
    };
  }, [panelOpen, panelTab, activeChannel, self?.identity]);

  // Fetch a channel the first time it is opened, and clear its badge.
  useEffect(() => {
    if (!selfId) return;
    if (!loadedRef.current.has(activeChannel)) {
      loadedRef.current.add(activeChannel);
      clientRef.current?.requestHistory(activeChannel);
    }
    if (panelOpen && panelTab === "chat") {
      setUnread((prev) => (prev[activeChannel] ? { ...prev, [activeChannel]: 0 } : prev));
    }
  }, [activeChannel, selfId, panelOpen, panelTab]);

  const sendChat = useCallback(
    (body: string) => clientRef.current?.sendChat(activeChannel, body),
    [activeChannel],
  );

  const loadOlder = useCallback(() => {
    const oldest = threads[activeChannel]?.[0]?.id;
    if (oldest !== undefined) clientRef.current?.requestHistory(activeChannel, oldest);
  }, [threads, activeChannel]);

  const updatePresence = useCallback((status: PresenceStatus, note: string) => {
    clientRef.current?.sendStatus(status, note);
  }, []);

  /** Where somebody is, in words — a room name, an area, or just the floor. */
  const locationOf = useCallback(
    (p: PlayerState) => {
      if (!floor) return "the floor";
      if (p.zoneId) return floor.zones.find((z) => z.id === p.zoneId)?.name ?? "a room";
      return floor.areas.find((a) => pointInRect(p.x, p.y, a))?.label ?? "the floor";
    },
    [floor],
  );

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
      if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        setPanelOpen((open) => !open);
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
    offline: "Offline",
  };

  const micLabel: Record<MicState, string> = {
    idle: "Starting mic",
    requesting: "Allow microphone…",
    live: muted ? "Muted" : "Mic live",
    denied: "Mic blocked",
    unavailable: "No microphone",
  };

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  return (
    <div className={`office${panelOpen ? " with-panel" : ""}`}>
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

        <button
          type="button"
          className={`hud-btn${panelOpen ? " active" : ""}`}
          onClick={() => setPanelOpen((open) => !open)}
          aria-pressed={panelOpen}
        >
          Chat
          {!panelOpen && totalUnread > 0 && <span className="pip">{totalUnread}</span>}
        </button>
      </div>

      {panelOpen && (
        <SidePanel
          players={players}
          self={self}
          tab={panelTab}
          onTab={setPanelTab}
          onClose={() => setPanelOpen(false)}
          activeChannel={activeChannel}
          onChannel={setActiveChannel}
          messages={threads[activeChannel] ?? []}
          hasMore={hasMore[activeChannel] ?? false}
          unread={unread}
          onSend={sendChat}
          onLoadOlder={loadOlder}
          onStatus={updatePresence}
          onFind={(id) => sceneRef.current?.walkToPlayer(id)}
          locationOf={locationOf}
        />
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
