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
import { MessageStore } from "./store";
import { createTask, notionConfigured } from "./notion";
import {
  woventexFloor,
  canAccessChannel,
  toIdentity,
  MAX_AVATAR_CHARS,
  resolveMove,
  collisionRects,
  zoneAt,
  distance,
  AVATAR_COLORS,
  MOVE_SPEED,
  PLAYER_RADIUS,
  SPEED_TOLERANCE,
  TICK_HZ,
  type ClientMessage,
  type PlayerState,
  type PresenceStatus,
  type ServerMessage,
} from "@wtoffice/shared";

const store = new MessageStore();

const STATUSES: PresenceStatus[] = ["available", "focusing", "away"];

/**
 * Who task confirmations are posted as.
 *
 * Deliberately not a real identity: `toIdentity` folds a name to lowercase
 * letters and digits, so this contains a character no person's identity can,
 * and it can never collide with a colleague's direct messages.
 */
const NOTION_IDENTITY = "system:notion";

const PORT = Number(process.env.PORT ?? 3001);
const floor = woventexFloor;

/**
 * Doors that are currently shut. Authoritative here so a modified client cannot
 * walk through one, and so collision geometry is identical on both sides.
 */
const shutDoors = new Set<string>();

/** Collision geometry for right now. Recomputed only when a door moves. */
let activeWalls: ReturnType<typeof collisionRects> = collisionRects(floor, new Set());
function refreshWalls(): void {
  activeWalls = collisionRects(floor, shutDoors);
}

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
  const resolved = resolveMove(from, target, PLAYER_RADIUS, activeWalls, floor);

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

      const name = sanitiseName(msg.name);
      const player: PlayerState = {
        id,
        name,
        identity: toIdentity(name),
        status: "available",
        note: "",
        color: AVATAR_COLORS[(nextId - 2) % AVATAR_COLORS.length],
        x: floor.spawn.x,
        y: floor.spawn.y,
        zoneId: zoneAt(floor.spawn.x, floor.spawn.y, floor.zones),
        speaking: false,
        muted: false,
        cameraOn: false,
        screenOn: false,
        broadcasting: false,
      };
      // Whatever this identity last set, if anything. This is the whole point
      // of keying profiles by identity rather than connection.
      const stored = store.avatarFor(player.identity);
      if (stored) player.avatar = stored;

      conn.player = player;
      conn.lastMoveAt = Date.now();

      send(socket, {
        t: "welcome",
        selfId: id,
        floor,
        players: livePlayers(),
        shutDoors: [...shutDoors],
      });
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
      // Whether a face or screen is being published. Routing is by transceiver
      // position, so these are only on/off flags.
      if (!conn.player) return;
      conn.player.cameraOn = Boolean(msg.cameraOn);
      conn.player.screenOn = Boolean(msg.screenOn);
      return;
    }

    if (msg.t === "broadcast") {
      if (!conn.player) return;
      conn.player.broadcasting = Boolean(msg.on);
      return;
    }

    if (msg.t === "door") {
      const player = conn.player;
      if (!player) return;

      const door = floor.doors.find((d) => d.id === msg.id);
      if (!door) return;

      // Only from inside. Otherwise anyone could shut a room's door on the
      // people in it, or open it on a private conversation from the corridor.
      if (player.zoneId !== door.zoneId) return;

      const shouldShut = !msg.open;
      if (shutDoors.has(door.id) === shouldShut) return;

      if (shouldShut) shutDoors.add(door.id);
      else shutDoors.delete(door.id);

      refreshWalls();
      broadcast({ t: "doors", shut: [...shutDoors] });
      console.log(`[door]  ${door.id} ${shouldShut ? "shut" : "opened"} by ${player.name}`);
      return;
    }

    if (msg.t === "knock") {
      const player = conn.player;
      if (!player) return;

      const door = floor.doors.find((d) => d.id === msg.doorId);
      if (!door) return;

      // Knocking only makes sense from outside the room you want into.
      if (player.zoneId === door.zoneId) return;

      // Delivered only to the people who could answer it.
      for (const other of connections.values()) {
        if (other.player?.zoneId !== door.zoneId) continue;
        send(other.socket, {
          t: "knock",
          doorId: door.id,
          from: player.id,
          name: player.name,
        });
      }
      return;
    }

    if (msg.t === "status") {
      const player = conn.player;
      if (!player) return;
      if (STATUSES.includes(msg.status)) player.status = msg.status;
      player.note = typeof msg.note === "string" ? msg.note.trim().slice(0, 80) : "";
      return;
    }

    if (msg.t === "avatar") {
      const player = conn.player;
      if (!player) return;

      const data = typeof msg.data === "string" ? msg.data : "";
      // Only images, only inline, and only within the cap. A data URL is the
      // simplest thing that works for five people and needs no file serving,
      // but it does travel in every state broadcast, so the size matters.
      if (data && !/^data:image\/(png|jpeg|webp);base64,/.test(data)) return;
      if (data.length > MAX_AVATAR_CHARS) return;

      store.saveAvatar(player.identity, data);
      if (data) player.avatar = data;
      else delete player.avatar;
      return;
    }

    if (msg.t === "chat") {
      const player = conn.player;
      if (!player) return;

      const body = typeof msg.body === "string" ? msg.body.trim() : "";
      if (!body) return;

      const channel = String(msg.channel);
      // A DM you are not part of is not yours to post in.
      if (!canAccessChannel(channel, player.identity)) return;

      const post = (author: string, identity: string, text: string) => {
        const message = store.append(channel, author, identity, text);
        for (const other of connections.values()) {
          if (!other.player) continue;
          if (!canAccessChannel(channel, other.player.identity)) continue;
          send(other.socket, { t: "chat", message });
        }
      };

      post(player.name, player.identity, body);

      // "/task something" files it in Notion. The message goes up first and the
      // answer follows, so the room sees what was asked even if Notion is slow.
      const task = body.match(/^\/task\s+(.+)$/i);
      if (task) {
        const title = task[1].trim().slice(0, 200);
        void createTask(title, player.name).then((result) => {
          post("Notion", NOTION_IDENTITY, result.message);
        });
      }
      return;
    }

    if (msg.t === "history") {
      const player = conn.player;
      if (!player) return;

      const channel = String(msg.channel);
      if (!canAccessChannel(channel, player.identity)) return;

      const before = typeof msg.before === "number" ? msg.before : undefined;
      const { messages, hasMore } = store.history(channel, before);
      send(socket, { t: "history", channel, messages, hasMore });
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

/**
 * Reopen doors on empty rooms.
 *
 * Doors can only be worked from inside, so a room whose last occupant left or
 * disconnected while it was shut would be sealed permanently — nobody outside
 * can open it, and nobody can get in to try. Releasing empty rooms removes that
 * dead end entirely.
 */
function reopenEmptyRooms(): void {
  if (shutDoors.size === 0) return;

  const players = livePlayers();
  let changed = false;

  for (const doorId of [...shutDoors]) {
    const door = floor.doors.find((d) => d.id === doorId);
    if (!door) {
      shutDoors.delete(doorId);
      changed = true;
      continue;
    }
    if (!players.some((p) => p.zoneId === door.zoneId)) {
      shutDoors.delete(doorId);
      changed = true;
      console.log(`[door]  ${door.id} reopened — room empty`);
    }
  }

  if (changed) {
    refreshWalls();
    broadcast({ t: "doors", shut: [...shutDoors] });
  }
}

// Broadcast world state. Remote avatars are interpolated client-side between these.
setInterval(() => {
  const players = livePlayers();
  if (players.length > 0) broadcast({ t: "state", players });
  reopenEmptyRooms();
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
  console.log(
    notionConfigured
      ? "notion: connected — /task files to the Tasks database"
      : "notion: not configured — set NOTION_TOKEN and NOTION_TASKS_DB to enable /task",
  );
});
