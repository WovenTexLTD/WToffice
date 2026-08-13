"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfficeScene } from "@/world/OfficeScene";
import { OfficeClient, type ConnectionStatus } from "@/net/officeClient";
import { VoiceEngine, type MicState } from "@/audio/VoiceEngine";
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
          Walk with <strong>WASD</strong> or click where you want to go. You will hear people as
          you get close to them, and the meeting rooms are sealed.
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
  const voiceRef = useRef<VoiceEngine | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [micState, setMicState] = useState<MicState>("idle");
  const [muted, setMuted] = useState(false);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [zone, setZone] = useState<string | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Presence is only sent on change — an idle office costs no traffic.
    let lastSpeaking = false;
    let lastMuted = false;
    const pushPresence = (speaking: boolean, isMuted: boolean) => {
      if (speaking === lastSpeaking && isMuted === lastMuted) return;
      lastSpeaking = speaking;
      lastMuted = isMuted;
      clientRef.current?.sendPresence(speaking, isMuted);
      sceneRef.current?.setSelfVoice(speaking, isMuted);
    };

    const voice = new VoiceEngine({
      onSignal: (to, data) => clientRef.current?.sendSignal(to, data),
      onSpeakingChange: (speaking) => pushPresence(speaking, voice.isMuted()),
      onMicState: setMicState,
    });
    voiceRef.current = voice;

    const scene = new OfficeScene(host, {
      onPositionChange: (x, y) => clientRef.current?.sendPosition(x, y),
      onZoneChange: setZone,
      onGain: (peerId, gain) => voice.setGain(peerId, gain),
    });
    sceneRef.current = scene;

    const client = new OfficeClient(WS_URL, name, {
      onWelcome: (selfId, f, list) => {
        setFloor(f);
        setPlayers(list);
        scene.setFloor(f, selfId, list);
        // Start the mic once we know who we are; peers connect as they appear.
        void voice.start(selfId).then(() => voice.syncPeers(list.map((p) => p.id)));
      },
      onState: (list) => {
        setPlayers(list);
        scene.applyState(list);
        voice.syncPeers(list.map((p) => p.id));
      },
      onJoined: (player) => scene.addPlayer(player),
      onLeft: (id) => scene.removePlayer(id),
      onCorrect: (x, y) => scene.correctPosition(x, y),
      onStatus: setStatus,
      onSignal: (from, data) => void voice.handleSignal(from, data),
    });
    clientRef.current = client;

    void scene.init().then(() => client.connect());

    return () => {
      client.disconnect();
      voice.stop();
      scene.destroy();
      sceneRef.current = null;
      clientRef.current = null;
      voiceRef.current = null;
    };
  }, [name]);

  const toggleMute = useCallback(() => {
    const voice = voiceRef.current;
    if (!voice) return;
    const next = !voice.isMuted();
    voice.setMuted(next);
    setMuted(next);
    clientRef.current?.sendPresence(false, next);
    sceneRef.current?.setSelfVoice(false, next);
  }, []);

  // Space bar is the natural mute key, but only when nothing is focused.
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
          className={`mic-btn${muted ? " muted" : ""}`}
          onClick={toggleMute}
          disabled={micState !== "live"}
          aria-pressed={muted}
        >
          <span className={`dot ${micState === "live" ? (muted ? "reconnecting" : "online") : "offline"}`} />
          {micLabel[micState]}
        </button>

        <span className="hud-hint">WASD to move · space to mute</span>
      </div>

      {micState === "denied" && (
        <div className="banner">
          Microphone blocked. Allow it in your browser&apos;s site settings and reload — you can
          still walk around, but nobody will hear you.
        </div>
      )}
    </div>
  );
}
