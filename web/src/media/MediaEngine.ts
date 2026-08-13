/**
 * Proximity media — voice, camera and screenshare over mesh WebRTC.
 *
 * ── Still mesh, and the numbers still work ──────────────────────────────────
 * Faces render inside a ~44px circle, so capture is 320x320 capped at 250kbps
 * rather than the ~600 a naive 720p stream costs — 720p would just be discarded
 * by the scaler. Four outbound faces is ~1Mbps up, which a five-person office
 * can afford. The real trigger for an SFU is several people watching one
 * screenshare at once, at ~1.5Mbps a copy.
 *
 * Video is gated by zone, not distance: only a sealed room hides it. See
 * videoVisible() for why.
 *
 * ── Transceivers, and only one offerer ─────────────────────────────────────
 * Each connection carries exactly three m-lines in a fixed order — audio,
 * camera, screen — and position is the routing key. That means routing needs no
 * signalling at all, and toggling a camera never renegotiates, because
 * replaceTrack does not change the session. Matching on MediaStream id instead
 * is fragile: replaceTrack does not renegotiate, so a receiver may never learn
 * the msid it was asked to match.
 *
 * Only the side with the lower id creates those transceivers. Creating them on
 * both sides means both fire negotiationneeded and offer simultaneously; the
 * polite side rolls back, and its own transceivers are not reliably re-matched
 * to the offer's m-lines. It then reads a transceiver that was never associated
 * with the sender's — permanently muted, while the sender cheerfully reports
 * that it is sending. That is a genuinely hard failure to see from the outside,
 * which is what the diagnostics panel is for.
 *
 * Both sides re-derive the mapping from the negotiated session in rebind(), so
 * the answerer — which created none of them — agrees with the offerer.
 *
 * ── Playback ───────────────────────────────────────────────────────────────
 * Audio still plays through <audio> elements rather than a Web Audio graph, so
 * Chrome's echo cancellation stays on. See README for why that matters.
 */

import {
  CAMERA_FPS,
  CAMERA_HEIGHT,
  CAMERA_WIDTH,
  GAIN_SMOOTHING,
  SCREEN_FPS,
  SCREEN_MAX_WIDTH,
  SPEAKING_OFF,
  SPEAKING_ON,
  type SignalData,
} from "@wtoffice/shared";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

/** Keeps four concurrent camera streams inside a typical home uplink. */
const CAMERA_MAX_BITRATE = 250_000;
const SCREEN_MAX_BITRATE = 1_500_000;

export type MicState = "idle" | "requesting" | "live" | "denied" | "unavailable";
export type ShareState = "off" | "starting" | "on" | "denied";

export interface PeerDiagnostic {
  id: string;
  connection: RTCPeerConnectionState;
  ice: RTCIceConnectionState;
  gain: number;
  sendingVideo: boolean;
  /** m-line the camera negotiated onto, and the direction it settled on. */
  mid: string;
  direction: string;
  outbound: "sending" | "idle";
  inbound: "none" | "muted" | "live";
}

export interface MediaEngineCallbacks {
  onSignal(to: string, data: SignalData): void;
  onSpeakingChange(speaking: boolean): void;
  onMicState(state: MicState): void;
  /** Local publication changed — republish the stream-id map to the room. */
  onLocalMediaChange(cameraOn: boolean, screenOn: boolean): void;
  onCameraState(state: ShareState): void;
  onScreenState(state: ShareState): void;
  /** A remote stream arrived or went away; surfaces need re-binding. */
  onRemoteMediaChange(): void;
}

interface Peer {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;

  targetGain: number;
  renderedGain: number;

  pendingIce: RTCIceCandidateInit[];
  remoteReady: boolean;

  /* Perfect negotiation state */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;

  /**
   * Bound to the negotiated m-lines, in order: audio, camera, screen.
   *
   * Only the offering side creates these. The answering side binds to whatever
   * the offer produced — see rebind(). Null until negotiation associates them.
   */
  audioTx: RTCRtpTransceiver | null;
  cameraTx: RTCRtpTransceiver | null;
  screenTx: RTCRtpTransceiver | null;

  /** Cached wrappers so srcObject isn't reassigned every render. */
  remoteCamera: MediaStream | null;
  remoteScreen: MediaStream | null;

  /** Whether video is currently flowing to this peer. */
  sendingVideo: boolean;
}

export class MediaEngine {
  private selfId = "";
  private micStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peers = new Map<string, Peer>();

  /**
   * Desired per-peer state, held independently of whether the peer exists yet.
   *
   * The scene starts emitting proximity updates as soon as it has a floor, but
   * peers are not created until getUserMedia resolves — which waits on the
   * microphone permission prompt. Anything applied only to a live peer is
   * dropped during that window. Gain survives because it re-fires on every
   * movement; a boolean that only changes on zone transitions does not, and is
   * lost for the rest of the session.
   */
  private desiredGain = new Map<string, number>();
  private desiredVideo = new Map<string, boolean>();

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadBuffer: Float32Array<ArrayBuffer> | null = null;
  private speaking = false;

  private muted = false;
  private micState: MicState = "idle";
  private cameraState: ShareState = "off";
  private screenState: ShareState = "off";

  private rafId: number | null = null;
  private lastFrameAt = 0;
  private stopped = false;

  constructor(private readonly callbacks: MediaEngineCallbacks) {}

  /* ── Lifecycle ─────────────────────────────────────────────────── */

  /**
   * Adopt an identity. Synchronous, and called on every welcome.
   *
   * Deliberately separate from the microphone. Peering must not wait on a
   * permission prompt: a connection that cannot be built until the user clicks
   * "Allow" will miss the offer that arrives while the dialog is open, and with
   * a single offerer there is no second offer to cover for it.
   */
  attach(selfId: string): void {
    if (this.selfId && this.selfId !== selfId) {
      // Reconnected under a fresh id — every peer id is now stale.
      for (const id of [...this.peers.keys()]) this.removePeer(id);
      this.desiredGain.clear();
      this.desiredVideo.clear();
    }
    this.selfId = selfId;
    this.startLoop();
  }

  /**
   * Request the microphone and publish it to peers that already exist.
   *
   * Safe to call more than once. If it is denied the office still works — you
   * can see and hear everyone, they just cannot hear you.
   */
  async ensureMic(): Promise<void> {
    if (this.micStream || this.micState === "requesting") return;

    if (!navigator.mediaDevices?.getUserMedia) {
      this.setMicState("unavailable");
      return;
    }

    this.setMicState("requesting");
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch {
      this.setMicState("denied");
      return;
    }

    if (this.stopped) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
      return;
    }

    this.setupVoiceDetection();
    this.setMicState("live");

    // Peers built while the prompt was open have a silent audio sender.
    for (const peer of this.peers.values()) this.applyLocalTracks(peer);
  }

  stop(): void {
    this.stopped = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;

    for (const id of [...this.peers.keys()]) this.removePeer(id);
    for (const stream of [this.micStream, this.cameraStream, this.screenStream]) {
      stream?.getTracks().forEach((t) => t.stop());
    }
    this.micStream = null;
    this.cameraStream = null;
    this.screenStream = null;

    void this.audioCtx?.close();
    this.audioCtx = null;
    this.analyser = null;
  }

  private setMicState(state: MicState): void {
    this.micState = state;
    this.callbacks.onMicState(state);
  }

  private publishLocalMedia(): void {
    this.callbacks.onLocalMediaChange(this.cameraStream !== null, this.screenStream !== null);
  }

  /* ── Camera ────────────────────────────────────────────────────── */

  async setCamera(on: boolean): Promise<void> {
    if (on) {
      if (this.cameraStream) return;
      this.cameraState = "starting";
      this.callbacks.onCameraState("starting");
      try {
        this.cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: CAMERA_WIDTH },
            height: { ideal: CAMERA_HEIGHT },
            frameRate: { ideal: CAMERA_FPS },
            facingMode: "user",
          },
          audio: false,
        });
      } catch {
        this.cameraState = "denied";
        this.callbacks.onCameraState("denied");
        return;
      }

      // Browser chrome can stop the device independently of our UI.
      for (const track of this.cameraStream.getVideoTracks()) {
        track.onended = () => void this.setCamera(false);
      }

      for (const peer of this.peers.values()) this.attachCamera(peer);
      this.cameraState = "on";
      this.callbacks.onCameraState("on");
    } else {
      if (!this.cameraStream) return;
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
      // Keep the sender: dropping it would force a renegotiation on every
      // toggle. A null track simply stops the bytes.
      for (const peer of this.peers.values()) this.attachCamera(peer);
      this.cameraState = "off";
      this.callbacks.onCameraState("off");
    }

    this.publishLocalMedia();
    this.callbacks.onRemoteMediaChange();
  }

  /* ── Screenshare ───────────────────────────────────────────────── */

  async setScreen(on: boolean): Promise<void> {
    if (on) {
      if (this.screenStream) return;
      this.screenState = "starting";
      this.callbacks.onScreenState("starting");
      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: SCREEN_FPS }, width: { max: SCREEN_MAX_WIDTH } },
          audio: false,
        });
      } catch {
        this.screenState = "off"; // Cancelling the picker is not an error.
        this.callbacks.onScreenState("off");
        return;
      }

      // The browser's own "Stop sharing" button lives outside our UI.
      for (const track of this.screenStream.getVideoTracks()) {
        track.onended = () => void this.setScreen(false);
      }

      for (const peer of this.peers.values()) this.attachScreen(peer);
      this.screenState = "on";
      this.callbacks.onScreenState("on");
    } else {
      if (!this.screenStream) return;
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      for (const peer of this.peers.values()) this.attachScreen(peer);
      this.screenState = "off";
      this.callbacks.onScreenState("off");
    }

    this.publishLocalMedia();
    this.callbacks.onRemoteMediaChange();
  }

  /* ── Peers ─────────────────────────────────────────────────────── */

  syncPeers(ids: string[]): void {
    // No microphone gate: peering must not wait on a permission prompt.
    if (!this.selfId) return;

    const wanted = new Set(ids.filter((id) => id !== this.selfId));
    for (const id of wanted) if (!this.peers.has(id)) this.createPeer(id);
    for (const id of [...this.peers.keys()]) {
      if (wanted.has(id)) continue;
      this.removePeer(id);
      // They actually left; drop their desired state so it cannot go stale.
      this.desiredGain.delete(id);
      this.desiredVideo.delete(id);
    }
  }

  /**
   * Exactly one side of each pair must yield when both change the session at
   * once. Comparing ids is deterministic and needs no coordination.
   */
  private isInitiator(peerId: string): boolean {
    return this.selfId < peerId;
  }

  private createPeer(peerId: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const audioEl = new Audio();
    audioEl.autoplay = true;
    audioEl.volume = 0;

    // Only the offering side creates transceivers.
    //
    // Creating them on both sides means both fire negotiationneeded and offer
    // at once. The polite side then rolls back — and its own transceivers are
    // not reliably re-matched to the offer's m-lines, so it ends up reading one
    // that was never associated with the sender's. It stays muted forever while
    // the sender happily reports that it is sending.
    //
    // One offerer means exactly three m-lines, in a known order: audio, camera,
    // screen. Position is the routing key, so turning a camera on or off never
    // renegotiates — replaceTrack does not change the session.
    const initiator = this.isInitiator(peerId);

    const peer: Peer = {
      pc,
      audioEl,
      // Adopt whatever the scene already decided while we were waiting on the
      // microphone. Default to sending: same-floor is the common case, and the
      // scene corrects it on the next zone change either way.
      targetGain: this.desiredGain.get(peerId) ?? 0,
      renderedGain: 0,
      pendingIce: [],
      remoteReady: false,
      polite: !this.isInitiator(peerId),
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      audioTx: null,
      cameraTx: null,
      screenTx: null,
      remoteCamera: null,
      remoteScreen: null,
      sendingVideo: this.desiredVideo.get(peerId) ?? true,
    };
    this.peers.set(peerId, peer);

    if (initiator) {
      peer.audioTx = pc.addTransceiver("audio", { direction: "sendrecv" });
      peer.cameraTx = pc.addTransceiver("video", { direction: "sendrecv" });
      peer.screenTx = pc.addTransceiver("video", { direction: "sendrecv" });
      this.applyLocalTracks(peer);
    }

    // Both sides re-derive the mapping from the negotiated session, so they
    // always agree on which m-line is the face and which is the screen.
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === "stable") this.rebind(peer);
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        const desc = pc.localDescription;
        if (desc) {
          this.callbacks.onSignal(peerId, {
            kind: "description",
            type: desc.type as "offer" | "answer",
            sdp: desc.sdp,
          });
        }
      } catch {
        // Peer went away mid-negotiation; roster sync cleans up.
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.ontrack = (event) => {
      if (event.track.kind === "audio") {
        // Wrap the track directly rather than trusting event.streams — msid
        // survives negotiation unreliably once replaceTrack is in play.
        audioEl.srcObject = new MediaStream([event.track]);
        void audioEl.play().catch(() => undefined);
        return;
      }
      // Video needs no bookkeeping: the transceiver it arrived on already says
      // whether it is a face or a screen.
      this.callbacks.onRemoteMediaChange();
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.callbacks.onSignal(peerId, { kind: "ice", candidate: event.candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        this.removePeer(peerId);
        this.createPeer(peerId);
      }
    };

    return peer;
  }

  private removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.close();

    peer.audioEl.srcObject = null;
    peer.audioEl.pause();

    this.peers.delete(peerId);
    this.callbacks.onRemoteMediaChange();
  }

  /**
   * Re-derive which negotiated m-line is audio, camera and screen.
   *
   * Runs on both sides whenever signalling settles, reading only associated
   * transceivers in m-line order — so the answerer, which created none of them,
   * ends up with the same mapping as the offerer.
   */
  private rebind(peer: Peer): void {
    const kindOf = (t: RTCRtpTransceiver) => t.receiver.track?.kind ?? t.sender.track?.kind ?? null;

    // A mid means the transceiver is associated with an m-line. Checked rather
    // than currentDirection, which is still null between applying an offer and
    // producing the answer — exactly when the answerer needs to bind.
    const associated = peer.pc.getTransceivers().filter((t) => t.mid !== null);

    const audio = associated.filter((t) => kindOf(t) === "audio");
    const video = associated.filter((t) => kindOf(t) === "video");

    peer.audioTx = audio[0] ?? peer.audioTx;
    peer.cameraTx = video[0] ?? peer.cameraTx;
    peer.screenTx = video[1] ?? peer.screenTx;

    this.applyLocalTracks(peer);
    this.callbacks.onRemoteMediaChange();
  }

  /** Put our current mic, camera and screen onto this peer's senders. */
  private applyLocalTracks(peer: Peer): void {
    const mic = this.micStream?.getAudioTracks()[0] ?? null;
    if (peer.audioTx) {
      // The answerer's transceivers arrive recvonly; it must opt in to sending.
      if (peer.audioTx.direction !== "sendrecv") peer.audioTx.direction = "sendrecv";
      if (peer.audioTx.sender.track !== mic) void peer.audioTx.sender.replaceTrack(mic);
    }

    if (peer.cameraTx) {
      if (peer.cameraTx.direction !== "sendrecv") peer.cameraTx.direction = "sendrecv";
      void this.capBitrate(peer.cameraTx.sender, CAMERA_MAX_BITRATE);
    }
    if (peer.screenTx) {
      if (peer.screenTx.direction !== "sendrecv") peer.screenTx.direction = "sendrecv";
      void this.capBitrate(peer.screenTx.sender, SCREEN_MAX_BITRATE);
    }

    this.attachCamera(peer);
    this.attachScreen(peer);
  }

  /** Feed (or starve) this peer's camera transceiver. Never renegotiates. */
  private attachCamera(peer: Peer): void {
    const sender = peer.cameraTx?.sender;
    if (!sender) return;
    const track = this.cameraStream?.getVideoTracks()[0] ?? null;
    const wanted = peer.sendingVideo ? track : null;
    if (sender.track !== wanted) void sender.replaceTrack(wanted);
  }

  private attachScreen(peer: Peer): void {
    const sender = peer.screenTx?.sender;
    if (!sender) return;
    const track = this.screenStream?.getVideoTracks()[0] ?? null;
    const wanted = peer.sendingVideo ? track : null;
    if (sender.track !== wanted) void sender.replaceTrack(wanted);
  }

  private async capBitrate(sender: RTCRtpSender, maxBitrate: number): Promise<void> {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = maxBitrate;
      await sender.setParameters(params);
    } catch {
      // Not fatal — the stream just runs at the browser's default ceiling.
    }
  }

  /* ── Signalling ────────────────────────────────────────────────── */

  async handleSignal(from: string, data: SignalData): Promise<void> {
    // Never drop a signal waiting on the microphone. An offer discarded here is
    // never re-sent, and the connection simply never forms.
    if (!this.selfId) return;

    const peer = this.peers.get(from) ?? this.createPeer(from);
    const pc = peer.pc;

    try {
      if (data.kind === "description") {
        // Perfect negotiation: decide whether this description is safe to apply.
        const readyForOffer =
          !peer.makingOffer && (pc.signalingState === "stable" || peer.settingRemoteAnswer);
        const collision = data.type === "offer" && !readyForOffer;

        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;

        peer.settingRemoteAnswer = data.type === "answer";
        // A polite peer rolls back implicitly here when it collided.
        await pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
        peer.settingRemoteAnswer = false;
        peer.remoteReady = true;
        await this.flushIce(peer);

        if (data.type === "offer") {
          // Bind and opt into sending *before* answering, so the answer already
          // says sendrecv and no second negotiation is needed to start sending.
          this.rebind(peer);
          await pc.setLocalDescription();
          const desc = pc.localDescription;
          if (desc) {
            this.callbacks.onSignal(from, {
              kind: "description",
              type: desc.type as "offer" | "answer",
              sdp: desc.sdp,
            });
          }
        }
        return;
      }

      if (peer.remoteReady) {
        await pc.addIceCandidate(data.candidate);
      } else {
        peer.pendingIce.push(data.candidate);
      }
    } catch {
      // Stale or out-of-order signal. The connection-state handler rebuilds
      // the peer if it genuinely failed.
    }
  }

  private async flushIce(peer: Peer): Promise<void> {
    const queued = peer.pendingIce;
    peer.pendingIce = [];
    for (const candidate of queued) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch {
        // Individual bad candidates are expected; ignore.
      }
    }
  }

  /* ── Proximity ─────────────────────────────────────────────────── */

  /** How loudly we hear this peer. */
  setGain(peerId: string, gain: number): void {
    const value = Math.min(1, Math.max(0, gain));
    this.desiredGain.set(peerId, value);

    const peer = this.peers.get(peerId);
    if (peer) peer.targetGain = value;
  }

  /**
   * Whether our camera and screen are worth sending to this peer.
   *
   * Driven by whether *they* can hear *us*, which is not the same question as
   * setGain answers — a broadcaster is heard by everyone but hears only the
   * room around them. replaceTrack costs no renegotiation, so this is safe to
   * call as people walk around.
   */
  setVideoEnabled(peerId: string, enabled: boolean): void {
    // Recorded first, so a peer created later picks it up. The caller only
    // sends edges, so dropping one here loses it permanently.
    this.desiredVideo.set(peerId, enabled);

    const peer = this.peers.get(peerId);
    if (!peer || enabled === peer.sendingVideo) return;

    peer.sendingVideo = enabled;
    this.attachCamera(peer);
    this.attachScreen(peer);
  }

  /**
   * A peer's incoming face or screen.
   *
   * Read straight off the transceiver it was negotiated on, so it needs no
   * stream-id bookkeeping. The track exists even when the sender publishes
   * nothing — callers gate on the peer's cameraOn/screenOn flags.
   */
  getPeerVideo(peerId: string, role: "camera" | "screen"): MediaStream | null {
    const peer = this.peers.get(peerId);
    if (!peer) return null;

    const tx = role === "camera" ? peer.cameraTx : peer.screenTx;
    const track = tx?.receiver.track;
    if (!track) return null;

    const cached = role === "camera" ? peer.remoteCamera : peer.remoteScreen;
    if (cached && cached.getTracks()[0] === track) return cached;

    const stream = new MediaStream([track]);
    if (role === "camera") peer.remoteCamera = stream;
    else peer.remoteScreen = stream;
    return stream;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const track of this.micStream?.getAudioTracks() ?? []) track.enabled = !muted;
    if (muted && this.speaking) {
      this.speaking = false;
      this.callbacks.onSpeakingChange(false);
    }
  }

  /* ── Accessors ─────────────────────────────────────────────────── */

  isMuted(): boolean {
    return this.muted;
  }

  getMicState(): MicState {
    return this.micState;
  }

  getCameraState(): ShareState {
    return this.cameraState;
  }

  getScreenState(): ShareState {
    return this.screenState;
  }

  getLocalCameraStream(): MediaStream | null {
    return this.cameraStream;
  }

  getLocalScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  gainFor(peerId: string): number {
    return this.peers.get(peerId)?.renderedGain ?? 0;
  }

  /**
   * Per-peer media state, for the in-app diagnostics panel.
   *
   * `inbound` is the one that usually answers "why can't I see them":
   *  - none      the transceiver never negotiated a receiving track
   *  - muted     negotiated, but the sender is publishing nothing
   *  - live      frames are arriving
   */
  getDiagnostics(): PeerDiagnostic[] {
    const out: PeerDiagnostic[] = [];

    for (const [id, peer] of this.peers) {
      const cameraTx = peer.cameraTx;
      const inboundTrack = cameraTx?.receiver.track ?? null;
      out.push({
        id,
        connection: peer.pc.connectionState,
        ice: peer.pc.iceConnectionState,
        gain: peer.renderedGain,
        sendingVideo: peer.sendingVideo,
        mid: cameraTx?.mid ?? "-",
        direction: cameraTx?.currentDirection ?? "unbound",
        outbound: cameraTx?.sender.track ? "sending" : "idle",
        inbound: !inboundTrack ? "none" : inboundTrack.muted ? "muted" : "live",
      });
    }
    return out;
  }

  /* ── Loop ──────────────────────────────────────────────────────── */

  private startLoop(): void {
    // attach() may be called on every welcome; one loop is enough.
    if (this.rafId !== null || this.stopped) return;
    this.lastFrameAt = performance.now();
    const frame = (now: number) => {
      if (this.stopped) return;
      const dt = Math.min((now - this.lastFrameAt) / 1000, 0.1);
      this.lastFrameAt = now;
      this.smoothGains(dt);
      this.detectSpeech();
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private smoothGains(dt: number): void {
    const k = 1 - Math.exp(-GAIN_SMOOTHING * dt);
    for (const peer of this.peers.values()) {
      const delta = peer.targetGain - peer.renderedGain;
      if (Math.abs(delta) < 0.001) {
        if (peer.renderedGain !== peer.targetGain) {
          peer.renderedGain = peer.targetGain;
          peer.audioEl.volume = peer.renderedGain;
        }
        continue;
      }
      peer.renderedGain += delta * k;
      peer.audioEl.volume = Math.min(1, Math.max(0, peer.renderedGain));
    }
  }

  private setupVoiceDetection(): void {
    if (!this.micStream) return;
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(this.micStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      // Analyser only — never connected to ctx.destination, so AEC is unaffected.
      source.connect(analyser);
      this.audioCtx = ctx;
      this.analyser = analyser;
      this.vadBuffer = new Float32Array(analyser.fftSize);
      void ctx.resume();
    } catch {
      // Voice detection is cosmetic; carry on without it.
    }
  }

  private detectSpeech(): void {
    const analyser = this.analyser;
    const buffer = this.vadBuffer;
    if (!analyser || !buffer || this.muted) return;

    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    const rms = Math.sqrt(sum / buffer.length);

    const next = this.speaking ? rms > SPEAKING_OFF : rms > SPEAKING_ON;
    if (next !== this.speaking) {
      this.speaking = next;
      this.callbacks.onSpeakingChange(next);
    }
  }
}
