/**
 * Proximity media — voice, camera and screenshare over mesh WebRTC.
 *
 * ── Still mesh, and the numbers still work ──────────────────────────────────
 * Video looked like the point where an SFU takes over, but two things change
 * the arithmetic. Faces render inside a ~44px circle, so capture is 320x320 and
 * costs ~200kbps rather than the ~600 a naive 720p stream would. And audioGain
 * is symmetric: a sender already knows which peers cannot hear it, so it can
 * stop sending video to them entirely with replaceTrack(null) — no
 * renegotiation, no bytes. That is the same bandwidth strategy Kumospace uses
 * an SFU for, done at the sender.
 *
 * Typical load is one or two active video streams, not four. The real trigger
 * for an SFU is several people watching one screenshare at once: that fans out
 * at ~1.5Mbps a copy. If that becomes routine, revisit.
 *
 * ── Negotiation ────────────────────────────────────────────────────────────
 * Turning a camera on mid-call changes the session, and both sides may change
 * it at once. This implements the standard perfect-negotiation pattern: one
 * side of each pair is "polite" and yields on collision, the other ignores the
 * colliding offer. Without it, two people enabling video simultaneously wedges
 * the connection.
 *
 * Senders are created once and then fed with replaceTrack, so toggling a camera
 * or moving in and out of earshot costs no negotiation at all.
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

export interface MediaEngineCallbacks {
  onSignal(to: string, data: SignalData): void;
  onSpeakingChange(speaking: boolean): void;
  onMicState(state: MicState): void;
  /** Local publication changed — republish the stream-id map to the room. */
  onLocalMediaChange(cameraStreamId: string | null, screenStreamId: string | null): void;
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

  /* Created once, then fed with replaceTrack */
  cameraSender: RTCRtpSender | null;
  screenSender: RTCRtpSender | null;
  /** Whether video is currently flowing to this peer (proximity-gated). */
  sendingVideo: boolean;

  streamIds: Set<string>;
}

export class MediaEngine {
  private selfId = "";
  private micStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peers = new Map<string, Peer>();

  /** Every remote stream we have received, keyed by its id. */
  private remoteStreams = new Map<string, MediaStream>();

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
   * Called on every welcome, including after a reconnect. The server issues a
   * fresh id each time, so an existing session must drop all peers (their ids
   * are now stale) and re-key — without requesting a second mic stream.
   */
  async start(selfId: string): Promise<void> {
    if (this.micStream) {
      for (const id of [...this.peers.keys()]) this.removePeer(id);
      this.selfId = selfId;
      return;
    }

    this.selfId = selfId;

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
      return;
    }

    this.setupVoiceDetection();
    this.setMicState("live");
    this.startLoop();
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
    this.remoteStreams.clear();

    void this.audioCtx?.close();
    this.audioCtx = null;
    this.analyser = null;
  }

  private setMicState(state: MicState): void {
    this.micState = state;
    this.callbacks.onMicState(state);
  }

  private publishLocalMedia(): void {
    this.callbacks.onLocalMediaChange(
      this.cameraStream?.id ?? null,
      this.screenStream?.id ?? null,
    );
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

      for (const [peerId, peer] of this.peers) this.attachCamera(peerId, peer);
      this.cameraState = "on";
      this.callbacks.onCameraState("on");
    } else {
      if (!this.cameraStream) return;
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
      // Keep the sender: dropping it would force a renegotiation on every
      // toggle. A null track simply stops the bytes.
      for (const peer of this.peers.values()) void peer.cameraSender?.replaceTrack(null);
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

      for (const [peerId, peer] of this.peers) this.attachScreen(peerId, peer);
      this.screenState = "on";
      this.callbacks.onScreenState("on");
    } else {
      if (!this.screenStream) return;
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      for (const peer of this.peers.values()) void peer.screenSender?.replaceTrack(null);
      this.screenState = "off";
      this.callbacks.onScreenState("off");
    }

    this.publishLocalMedia();
    this.callbacks.onRemoteMediaChange();
  }

  /* ── Peers ─────────────────────────────────────────────────────── */

  syncPeers(ids: string[]): void {
    if (!this.micStream) return;

    const wanted = new Set(ids.filter((id) => id !== this.selfId));
    for (const id of wanted) if (!this.peers.has(id)) this.createPeer(id);
    for (const id of [...this.peers.keys()]) if (!wanted.has(id)) this.removePeer(id);
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

    const peer: Peer = {
      pc,
      audioEl,
      targetGain: 0,
      renderedGain: 0,
      pendingIce: [],
      remoteReady: false,
      polite: !this.isInitiator(peerId),
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      cameraSender: null,
      screenSender: null,
      sendingVideo: false,
      streamIds: new Set(),
    };
    this.peers.set(peerId, peer);

    if (this.micStream) {
      for (const track of this.micStream.getAudioTracks()) pc.addTrack(track, this.micStream);
    }
    if (this.cameraStream) this.attachCamera(peerId, peer);
    if (this.screenStream) this.attachScreen(peerId, peer);

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
      const [stream] = event.streams;
      if (!stream) return;

      if (event.track.kind === "audio") {
        audioEl.srcObject = stream;
        void audioEl.play().catch(() => undefined);
        return;
      }

      // Video: hold it by stream id. Which surface it belongs to is resolved
      // from the sender's published camera/screen ids in player state.
      this.remoteStreams.set(stream.id, stream);
      peer.streamIds.add(stream.id);
      stream.onremovetrack = () => {
        if (stream.getTracks().length === 0) {
          this.remoteStreams.delete(stream.id);
          peer.streamIds.delete(stream.id);
          this.callbacks.onRemoteMediaChange();
        }
      };
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

    for (const streamId of peer.streamIds) this.remoteStreams.delete(streamId);
    this.peers.delete(peerId);
    this.callbacks.onRemoteMediaChange();
  }

  /**
   * Create the camera sender once. Whether it actually carries a track is
   * decided by proximity in setGain, so walking in and out of earshot never
   * triggers renegotiation.
   */
  private attachCamera(peerId: string, peer: Peer): void {
    const track = this.cameraStream?.getVideoTracks()[0];
    if (!track || !this.cameraStream) return;

    if (!peer.cameraSender) {
      peer.cameraSender = peer.pc.addTrack(track, this.cameraStream);
      void this.capBitrate(peer.cameraSender, CAMERA_MAX_BITRATE);
    } else {
      void peer.cameraSender.replaceTrack(peer.sendingVideo ? track : null);
    }
    if (!peer.sendingVideo) void peer.cameraSender.replaceTrack(null);
  }

  private attachScreen(peerId: string, peer: Peer): void {
    const track = this.screenStream?.getVideoTracks()[0];
    if (!track || !this.screenStream) return;

    if (!peer.screenSender) {
      peer.screenSender = peer.pc.addTrack(track, this.screenStream);
      void this.capBitrate(peer.screenSender, SCREEN_MAX_BITRATE);
    } else {
      void peer.screenSender.replaceTrack(track);
    }
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
    if (!this.micStream) return;

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

  /**
   * Set the proximity volume for one peer, and gate outbound video on it.
   *
   * Gain is symmetric, so if we cannot hear them they cannot hear us — which
   * makes this the right place to decide whether our camera is worth sending.
   * replaceTrack costs no renegotiation, so this is safe to call as people walk.
   */
  setGain(peerId: string, gain: number): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.targetGain = Math.min(1, Math.max(0, gain));

    const shouldSend = gain > 0;
    if (shouldSend === peer.sendingVideo) return;
    peer.sendingVideo = shouldSend;

    const cameraTrack = this.cameraStream?.getVideoTracks()[0] ?? null;
    if (peer.cameraSender) void peer.cameraSender.replaceTrack(shouldSend ? cameraTrack : null);
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

  /** Look up a received stream by the id its publisher advertised. */
  getRemoteStream(streamId: string | null): MediaStream | null {
    if (!streamId) return null;
    return this.remoteStreams.get(streamId) ?? null;
  }

  gainFor(peerId: string): number {
    return this.peers.get(peerId)?.renderedGain ?? 0;
  }

  /* ── Loop ──────────────────────────────────────────────────────── */

  private startLoop(): void {
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
