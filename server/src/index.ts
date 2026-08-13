/**
 * WovenTex office — world state server.
 *
 * Trust model: clients simulate their own movement locally so it feels instant,
 * then report position at 15Hz. The server validates rather than simulates —
 * it rejects moves that clip walls, leave the world, or exceed walking speed,
 * and corrects the client when it does. That keeps movement responsive while
 * still making "teleport into the closed meeting room" impossible.
 */

import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  woventexFloor,
  resolveMove,
  zoneAt,
  distance,
  AVATAR_COLORS,
  MOVE_SPEED,
  PLAYER_RADIUS,
  SPEED_TOLERANCE,
  TICK_HZ,
  type ClientMessage,
  type PlayerState,
  type ServerMessage,
} from "@wtoffice/shared";

const PORT = Number(process.env.PORT ?? 3001);
const floor = woventexFloor;

interface Connection {
  socket: WebSocket;
  player: PlayerState | null;
  /** Timestamp of the last accepted move, for the speed check. */
  lastMoveAt: number;
  alive: boolean;
}

const connections = new Map<string, Connection>();
let nextId = 1;

/* ── Helpers ─────────────────────────────────────────────────────── */

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMessage, exceptId?: string): void {
  const payload = JSON.stringify(msg);
  for (const [id, conn] of connections) {
    if (id === exceptId || !conn.player) continue;
    if (conn.socket.readyState === WebSocket.OPEN) conn.socket.send(payload);
  }
}

function livePlayers(): PlayerState[] {
  const out: PlayerState[] = [];
  for (const conn of connections.values()) if (conn.player) out.push(conn.player);
  return out;
}

/** Trim to something safe to render, and never let it be empty. */
function sanitiseName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().slice(0, 24) : "";
  return s.length > 0 ? s : "Guest";
}

/* ── Move validation ─────────────────────────────────────────────── */

/**
 * Accept, clamp or reject a reported position.
 * Returns the authoritative position and whether the client needs correcting.
 */
function validateMove(
  player: PlayerState,
  requested: { x: number; y: number },
  elapsedMs: number,
): { x: number; y: number; corrected: boolean } {
  const from = { x: player.x, y: player.y };

  if (!Number.isFinite(requested.x) || !Number.isFinite(requested.y)) {
    return { ...from, corrected: true };
  }

  // Cap travel since the last accepted move. Generous, because network jitter
  // arrives as bursts — a tight bound produces constant false corrections.
  const budget = (MOVE_SPEED * Math.max(elapsedMs, 16)) / 1000 * SPEED_TOLERANCE;
  const asked = distance(from, requested);

  let target = requested;
  if (asked > budget) {
    const k = budget / asked;
    target = { x: from.x + (requested.x - from.x) * k, y: from.y + (requested.y - from.y) * k };
  }

  // Same collision resolution the client ran, so results agree.
  const resolved = resolveMove(from, target, PLAYER_RADIUS, floor.walls, floor);

  // Only correct on a meaningful divergence; sub-pixel drift is not worth a packet.
  const corrected = distance(resolved, requested) > 2;
  return { x: resolved.x, y: resolved.y, corrected };
}

/* ── Connection lifecycle ────────────────────────────────────────── */

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, players: livePlayers().length }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  const id = `p${nextId++}`;
  const conn: Connection = { socket, player: null, lastMoveAt: Date.now(), alive: true };
  connections.set(id, conn);

  socket.on("pong", () => {
    conn.alive = true;
  });

  socket.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return; // Malformed frame — ignore rather than drop the connection.
    }

    if (msg.t === "join") {
      if (conn.player) return; // Already joined; ignore duplicates.

      const player: PlayerState = {
        id,
        name: sanitiseName(msg.name),
        color: AVATAR_COLORS[(nextId - 2) % AVATAR_COLORS.length],
        x: floor.spawn.x,
        y: floor.spawn.y,
        zoneId: zoneAt(floor.spawn.x, floor.spawn.y, floor.zones),
        speaking: false,
        muted: false,
        cameraStreamId: null,
        screenStreamId: null,
      };
      conn.player = player;
      conn.lastMoveAt = Date.now();

      send(socket, { t: "welcome", selfId: id, floor, players: livePlayers() });
      broadcast({ t: "joined", player }, id);
      console.log(`[join]  ${player.name} (${id}) — ${livePlayers().length} online`);
      return;
    }

    if (msg.t === "move") {
      const player = conn.player;
      if (!player) return;

      const now = Date.now();
      const result = validateMove(player, msg, now - conn.lastMoveAt);
      conn.lastMoveAt = now;

      player.x = result.x;
      player.y = result.y;
      player.zoneId = zoneAt(result.x, result.y, floor.zones);

      if (result.corrected) send(socket, { t: "correct", x: result.x, y: result.y });
      return;
    }

    if (msg.t === "presence") {
      if (!conn.player) return;
      conn.player.speaking = Boolean(msg.speaking);
      conn.player.muted = Boolean(msg.muted);
      return;
    }

    if (msg.t === "media") {
      // Which stream id carries the face and which carries the screen. Relayed
      // in state so receivers can route incoming tracks to the right surface.
      if (!conn.player) return;
      conn.player.cameraStreamId = typeof msg.cameraStreamId === "string" ? msg.cameraStreamId : null;
      conn.player.screenStreamId = typeof msg.screenStreamId === "string" ? msg.screenStreamId : null;
      return;
    }

    if (msg.t === "signal") {
      // Relay WebRTC signalling verbatim. The server never inspects the payload
      // and never joins the call — media is peer-to-peer.
      if (!conn.player) return;
      const target = connections.get(msg.to);
      if (!target?.player) return;
      send(target.socket, { t: "signal", from: id, data: msg.data });
    }
  });

  const drop = () => {
    const player = conn.player;
    connections.delete(id);
    if (player) {
      broadcast({ t: "left", id });
      console.log(`[leave] ${player.name} (${id}) — ${livePlayers().length} online`);
    }
  };

  socket.on("close", drop);
  socket.on("error", drop);
});

/* ── Loops ───────────────────────────────────────────────────────── */

// Broadcast world state. Remote avatars are interpolated client-side between these.
setInterval(() => {
  const players = livePlayers();
  if (players.length > 0) broadcast({ t: "state", players });
}, 1000 / TICK_HZ);

// Reap connections that stopped responding (laptop lid closed, network dropped).
setInterval(() => {
  for (const [id, conn] of connections) {
    if (!conn.alive) {
      conn.socket.terminate();
      connections.delete(id);
      if (conn.player) broadcast({ t: "left", id });
      continue;
    }
    conn.alive = false;
    conn.socket.ping();
  }
}, 15_000);

httpServer.listen(PORT, () => {
  console.log(`WovenTex office server → ws://localhost:${PORT}`);
  console.log(`floor "${floor.name}" — ${floor.walls.length} walls, ${floor.zones.length} zones`);
});
