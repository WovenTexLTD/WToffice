/**
 * WebSocket client for the office world server.
 *
 * Deliberately thin: it owns the socket and reconnection, and hands parsed
 * messages to the scene. All simulation lives in the scene.
 */

import type {
  ClientMessage,
  Floor,
  NotionSource,
  NotionTask,
  TaskAlert,
  PlayerState,
  PresenceStatus,
  ServerMessage,
  SignalData,
} from "@wtoffice/shared";

export interface OfficeClientHandlers {
  onWelcome(selfId: string, floor: Floor, players: PlayerState[], shutDoors: string[]): void;
  onState(players: PlayerState[]): void;
  onJoined(player: PlayerState): void;
  onLeft(id: string): void;
  onCorrect(x: number, y: number): void;
  onStatus(status: ConnectionStatus): void;
  onSignal(from: string, data: SignalData): void;
  onDoors(shut: string[]): void;
  onKnock(doorId: string, name: string): void;
  onWatching(databases: string[]): void;
  onAlert(alert: TaskAlert): void;
  /** The backlog, delivered on join. */
  onAlerts(alerts: TaskAlert[]): void;
  onTasks(
    items: NotionTask[],
    sources: NotionSource[],
    database: string,
    statuses: string[],
    configured: boolean,
    error?: string,
  ): void;
}

export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "offline";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

export class OfficeClient {
  private socket: WebSocket | null = null;
  private closedByUs = false;
  /** Terminal: set by disconnect(), never cleared. */
  private disposed = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;

  constructor(
    private readonly url: string,
    private readonly name: string,
    private readonly handlers: OfficeClientHandlers,
  ) {}

  connect(): void {
    // Once disconnected, stay disconnected.
    //
    // React double-invokes effects in development, and connect() is reached
    // from an async continuation — so without this guard the first, already
    // cleaned-up client opens a socket anyway and the office shows two of you.
    if (this.disposed) return;

    this.closedByUs = false;
    this.handlers.onStatus(this.attempt === 0 ? "connecting" : "reconnecting");

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.handlers.onStatus("online");
      this.send({ t: "join", name: this.name });
    };

    socket.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.t) {
        case "welcome":
          this.handlers.onWelcome(msg.selfId, msg.floor, msg.players, msg.shutDoors);
          break;
        case "doors":
          this.handlers.onDoors(msg.shut);
          break;
        case "knock":
          this.handlers.onKnock(msg.doorId, msg.name);
          break;
        case "watching":
          this.handlers.onWatching(msg.databases);
          break;
        case "alert":
          this.handlers.onAlert(msg.alert);
          break;
        case "alerts":
          this.handlers.onAlerts(msg.alerts);
          break;
        case "tasks":
          this.handlers.onTasks(
            msg.items,
            msg.sources,
            msg.database,
            msg.statuses,
            msg.configured,
            msg.error,
          );
          break;
        case "state":
          this.handlers.onState(msg.players);
          break;
        case "joined":
          this.handlers.onJoined(msg.player);
          break;
        case "left":
          this.handlers.onLeft(msg.id);
          break;
        case "correct":
          this.handlers.onCorrect(msg.x, msg.y);
          break;
        case "signal":
          this.handlers.onSignal(msg.from, msg.data);
          break;
      }
    };

    socket.onclose = () => {
      if (this.closedByUs) return;
      this.handlers.onStatus("reconnecting");
      this.scheduleReconnect();
    };

    // An error is always followed by a close; let close drive reconnection.
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  sendPosition(x: number, y: number): void {
    this.send({ t: "move", x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  sendSignal(to: string, data: SignalData): void {
    this.send({ t: "signal", to, data });
  }

  sendPresence(speaking: boolean, muted: boolean): void {
    this.send({ t: "presence", speaking, muted });
  }

  /** Publish whether we are showing a face or a screen. */
  sendMedia(cameraOn: boolean, screenOn: boolean): void {
    this.send({ t: "media", cameraOn, screenOn });
  }

  sendBroadcast(on: boolean): void {
    this.send({ t: "broadcast", on });
  }

  sendDoor(id: string, open: boolean): void {
    this.send({ t: "door", id, open });
  }

  sendKnock(doorId: string): void {
    this.send({ t: "knock", doorId });
  }

  /** Ask for a task list. Omit the database for the server's default. */
  requestTasks(database?: string): void {
    this.send({ t: "tasks", database });
  }

  /** Acknowledge queued alerts, so they do not come back next sign-in. */
  markAlertsSeen(): void {
    this.send({ t: "seen" });
  }

  /** Start or stop being told about new tasks in a database. */
  setWatch(database: string, on: boolean): void {
    this.send({ t: "watch", database, on });
  }

  /** File a task. The server answers with a refreshed list. */
  createTask(title: string, priority?: string, due?: string, database?: string): void {
    this.send({ t: "task", title, priority, due, database });
  }

  /** Set the profile picture for this identity, or clear it with "". */
  sendAvatar(data: string): void {
    this.send({ t: "avatar", data });
  }

  sendStatus(status: PresenceStatus, note: string): void {
    this.send({ t: "status", status, note });
  }

  disconnect(): void {
    this.disposed = true;
    this.closedByUs = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.handlers.onStatus("offline");
  }
}
