"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfficeScene } from "@/world/OfficeScene";
import { OfficeClient, type ConnectionStatus } from "@/net/officeClient";
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
          Walk around with <strong>WASD</strong> or click where you want to go. Proximity audio
          lands next — for now, everyone can see where everyone is.
        </p>
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

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [zone, setZone] = useState<string | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new OfficeScene(host, {
      onPositionChange: (x, y) => clientRef.current?.sendPosition(x, y),
      onZoneChange: (zoneId) => setZone(zoneId),
    });
    sceneRef.current = scene;

    const client = new OfficeClient(WS_URL, name, {
      onWelcome: (selfId, f, list) => {
        setFloor(f);
        setPlayers(list);
        scene.setFloor(f, selfId, list);
      },
      onState: (list) => {
        setPlayers(list);
        scene.applyState(list);
      },
      onJoined: (player) => scene.addPlayer(player),
      onLeft: (id) => scene.removePlayer(id),
      onCorrect: (x, y) => scene.correctPosition(x, y),
      onStatus: setStatus,
    });
    clientRef.current = client;

    void scene.init().then(() => client.connect());

    return () => {
      client.disconnect();
      scene.destroy();
      sceneRef.current = null;
      clientRef.current = null;
    };
  }, [name]);

  const zoneName = useCallback(
    (id: string | null) => floor?.zones.find((z) => z.id === id)?.name ?? null,
    [floor],
  );

  const label: Record<ConnectionStatus, string> = {
    connecting: "Connecting",
    online: `${players.length} in the office`,
    reconnecting: "Reconnecting",
    offline: "Offline",
  };

  return (
    <div className="office">
      <div className="stage" ref={hostRef} />
      <div className="hud">
        <span className="hud-status mono">
          <span className={`dot ${status}`} />
          {label[status]}
        </span>

        <span className="hud-roster">
          {players.map((p) => (
            <span
              key={p.id}
              className="chip"
              style={{ background: p.color }}
              title={p.name}
            >
              {p.name.slice(0, 2).toUpperCase()}
            </span>
          ))}
        </span>

        {zone && <span className="hud-zone mono">In {zoneName(zone)}</span>}

        <span className="hud-spacer" />
        <span className="hud-hint">WASD or click to move · scroll to zoom</span>
      </div>
    </div>
  );
}
