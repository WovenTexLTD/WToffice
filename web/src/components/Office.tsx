"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfficeScene } from "@/world/OfficeScene";
import { OfficeClient, type ConnectionStatus } from "@/net/officeClient";
import { MediaEngine, type MicState, type ShareState } from "@/media/MediaEngine";
import { VideoOverlay } from "@/video/VideoOverlay";
import type { Floor, PlayerState } from "@wtoffice/shared";

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

  /** Peers currently within earshot. A ref because it updates at frame rate. */
  const audibleRef = useRef<Set<string>>(new Set());

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
      onLocalMediaChange: (cameraStreamId, screenStreamId) =>
        clientRef.current?.sendMedia(cameraStreamId, screenStreamId),
      onRemoteMediaChange: bumpMedia,
    });
    mediaRef.current = media;

    const scene = new OfficeScene(host, {
      onPositionChange: (x, y) => clientRef.current?.sendPosition(x, y),
      onZoneChange: setZone,
      onGain: (peerId, gain) => {
        media.setGain(peerId, gain);

        // Earshot membership gates the screenshare viewer. Only react when it
        // actually crosses the boundary, not on every frame of a fade.
        const wasAudible = audibleRef.current.has(peerId);
        const isAudible = gain > 0;
        if (wasAudible !== isAudible) {
          if (isAudible) audibleRef.current.add(peerId);
          else audibleRef.current.delete(peerId);
          bumpMedia();
        }
      },
      onSendVideo: (peerId, enabled) => media.setVideoEnabled(peerId, enabled),
      onDoorToggle: (doorId, open) => clientRef.current?.sendDoor(doorId, open),
      onKnock: (doorId) => clientRef.current?.sendKnock(doorId),
    });
    sceneRef.current = scene;

    const client = new OfficeClient(WS_URL, name, {
      onWelcome: (id, f, list, shutDoors) => {
        setSelfId(id);
        setFloor(f);
        setPlayers(list);
        scene.setFloor(f, id, list, shutDoors);
        void media.start(id).then(() => media.syncPeers(list.map((p) => p.id)));
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
        audibleRef.current.delete(id);
      },
      onCorrect: (x, y) => scene.correctPosition(x, y),
      onStatus: setStatus,
      onSignal: (from, data) => void media.handleSignal(from, data),
    });
    clientRef.current = client;

    void scene.init().then(() => {
      // Created after init so it stacks above the canvas the scene appended.
      const overlay = new VideoOverlay(host);
      overlayRef.current = overlay;
      scene.setSurface(overlay);
      client.connect();
    });

    return () => {
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

    for (const p of players) {
      const isSelf = p.id === selfId;
      const stream = isSelf
        ? media.getLocalCameraStream()
        : media.getRemoteStream(p.cameraStreamId);
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
      if (e.code !== "Space") return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      toggleMute();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMute]);

  const zoneName = useCallback(
    (id: string | null) => floor?.zones.find((z) => z.id === id)?.name ?? null,
    [floor],
  );

  /* Only shares from people you could hear — the same rule as voice. */
  const sharer = players.find(
    (p) => p.screenStreamId && (p.id === selfId || audibleRef.current.has(p.id)),
  );

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
              : (mediaRef.current?.getRemoteStream(sharer.screenStreamId) ?? null)
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
      </div>

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
