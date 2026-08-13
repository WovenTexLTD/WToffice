/**
 * WebSocket client for the office world server.
 *
 * Deliberately thin: it owns the socket and reconnection, and hands parsed
 * messages to the scene. All simulation lives in the scene.
 */

import type { ClientMessage, Floor, PlayerState, ServerMessage, SignalData } from "@wtoffice/shared";

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
}

export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "offline";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

export class OfficeClient {
  private socket: WebSocket | null = null;
  private closedByUs = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;

  constructor(
    private readonly url: string,
    private readonly name: string,
    private readonly handlers: OfficeClientHandlers,
  ) {}

  connect(): void {
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

  /** Publish which stream id carries our face and which carries our screen. */
  sendMedia(cameraStreamId: string | null, screenStreamId: string | null): void {
    this.send({ t: "media", cameraStreamId, screenStreamId });
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

  disconnect(): void {
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
