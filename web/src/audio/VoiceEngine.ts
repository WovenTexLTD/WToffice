/**
 * Proximity voice.
 *
 * ── Transport: mesh peer-to-peer, not an SFU ────────────────────────────────
 * At five people, audio-only, mesh is the right answer. Opus runs ~32kbps, so
 * four outbound streams is ~128kbps — nothing. In exchange we get the lowest
 * possible latency (which is exactly what the "does this feel natural" question
 * turns on), no media server, no account, and no API key. The existing world
 * socket is already a perfect signalling channel.
 *
 * Revisit this at Phase 3. Video is ~600kbps per stream, so four outbound
 * becomes ~2.4Mbps up and anyone on a weak uplink suffers. That is the point
 * where an SFU starts paying for itself — not here.
 *
 * ── Playback: <audio> elements, deliberately not Web Audio ──────────────────
 * The classic trap in this product category is routing WebRTC audio through a
 * Web Audio graph to get a GainNode. Chrome's echo cancellation lives on the
 * media-element path, so the moment you do that, AEC silently switches off: it
 * sounds perfect in headphones and howls on laptop speakers. The usual fix is
 * looping the processed stream back through a local RTCPeerConnection, which
 * works but costs real complexity and kills stereo panning.
 *
 * We need exactly one thing from the graph — a volume control — and
 * HTMLMediaElement.volume already is one, on the native WebRTC render path
 * where AEC works. So there is no graph, and no trap to work around.
 *
 * Web Audio is still used for voice-activity detection, but only as an
 * AnalyserNode that is never connected to a destination. Nothing is played
 * through it, so AEC is unaffected.
 */

import {
  GAIN_SMOOTHING,
  SPEAKING_OFF,
  SPEAKING_ON,
  type SignalData,
} from "@wtoffice/shared";

/**
 * Public STUN is enough for the same LAN or anything behind a cone NAT.
 * Production needs TURN for the ~10-20% of connections behind symmetric NAT —
 * that lands in Phase 7 alongside deployment.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export type MicState = "idle" | "requesting" | "live" | "denied" | "unavailable";

export interface VoiceEngineCallbacks {
  onSignal(to: string, data: SignalData): void;
  onSpeakingChange(speaking: boolean): void;
  onMicState(state: MicState): void;
}

interface Peer {
  pc: RTCPeerConnection;
  el: HTMLAudioElement;
  /** Where the volume should be, from the proximity rule. */
  targetGain: number;
  /** Where it currently is. Smoothed toward target so movement doesn't click. */
  renderedGain: number;
  /** ICE can arrive before the remote description; hold it until we can apply it. */
  pendingIce: RTCIceCandidateInit[];
  remoteReady: boolean;
}

export class VoiceEngine {
  private selfId = "";
  private localStream: MediaStream | null = null;
  private peers = new Map<string, Peer>();

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  // Explicit ArrayBuffer parameter: getFloatTimeDomainData rejects a view that
  // might be backed by a SharedArrayBuffer.
  private vadBuffer: Float32Array<ArrayBuffer> | null = null;
  private speaking = false;

  private muted = false;
  private micState: MicState = "idle";
  private rafId: number | null = null;
  private lastFrameAt = 0;
  private stopped = false;

  constructor(private readonly callbacks: VoiceEngineCallbacks) {}

  /* ── Lifecycle ─────────────────────────────────────────────────── */

  /**
   * Called on every welcome, including after a reconnect. The server issues a
   * fresh id each time, so an existing session must drop all peers (their ids
   * are now stale) and re-key — without requesting a second mic stream.
   */
  async start(selfId: string): Promise<void> {
    if (this.localStream) {
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
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch {
      // Denied, or no input device. The office still works, silently.
      this.setMicState("denied");
      return;
    }

    if (this.stopped) {
      this.localStream.getTracks().forEach((t) => t.stop());
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
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.analyser = null;
  }

  private setMicState(state: MicState): void {
    this.micState = state;
    this.callbacks.onMicState(state);
  }

  /* ── Peers ─────────────────────────────────────────────────────── */

  /**
   * Reconcile the peer set against the roster. Safe to call on every server
   * broadcast — it only acts on the difference.
   */
  syncPeers(ids: string[]): void {
    if (!this.localStream) return; // No mic yet; the next sync will pick these up.

    const wanted = new Set(ids.filter((id) => id !== this.selfId));

    for (const id of wanted) {
      if (!this.peers.has(id)) this.createPeer(id);
    }
    for (const id of [...this.peers.keys()]) {
      if (!wanted.has(id)) this.removePeer(id);
    }
  }

  /**
   * Exactly one side of each pair must offer, or both do and the negotiation
   * collides. Comparing ids is deterministic and needs no coordination.
   */
  private isInitiator(peerId: string): boolean {
    return this.selfId < peerId;
  }

  private createPeer(peerId: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const el = new Audio();
    el.autoplay = true;
    el.volume = 0; // Fade up from silence; never pop in at full volume.

    const peer: Peer = {
      pc,
      el,
      targetGain: 0,
      renderedGain: 0,
      pendingIce: [],
      remoteReady: false,
    };
    this.peers.set(peerId, peer);

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      el.srcObject = stream;
      // Autoplay is permitted here: joining the office required a click.
      void el.play().catch(() => undefined);
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.callbacks.onSignal(peerId, {
        kind: "ice",
        candidate: event.candidate.toJSON(),
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        // Renegotiating from scratch is more reliable than ICE restart here,
        // and at this scale reconnecting one peer is cheap.
        this.removePeer(peerId);
        this.createPeer(peerId);
      }
    };

    if (this.isInitiator(peerId)) void this.makeOffer(peerId, peer);
    return peer;
  }

  private removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.el.srcObject = null;
    peer.el.pause();
    this.peers.delete(peerId);
  }

  private async makeOffer(peerId: string, peer: Peer): Promise<void> {
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.callbacks.onSignal(peerId, { kind: "offer", sdp: offer.sdp ?? "" });
    } catch {
      // Peer left mid-negotiation; the roster sync will clean up.
    }
  }

  async handleSignal(from: string, data: SignalData): Promise<void> {
    if (!this.localStream) return;

    const peer = this.peers.get(from) ?? this.createPeer(from);

    try {
      if (data.kind === "offer") {
        await peer.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
        peer.remoteReady = true;
        await this.flushIce(peer);

        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.callbacks.onSignal(from, { kind: "answer", sdp: answer.sdp ?? "" });
        return;
      }

      if (data.kind === "answer") {
        await peer.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
        peer.remoteReady = true;
        await this.flushIce(peer);
        return;
      }

      // Candidates routinely arrive before the description they belong to.
      if (peer.remoteReady) {
        await peer.pc.addIceCandidate(data.candidate);
      } else {
        peer.pendingIce.push(data.candidate);
      }
    } catch {
      // A stale or out-of-order signal. Dropping it is correct — the
      // connection-state handler rebuilds the peer if it actually failed.
    }
  }

  private async flushIce(peer: Peer): Promise<void> {
    const queued = peer.pendingIce;
    peer.pendingIce = [];
    for (const candidate of queued) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch {
        // Ignore individual bad candidates.
      }
    }
  }

  /* ── Gain ──────────────────────────────────────────────────────── */

  /** Set the proximity volume for one peer. Applied smoothly, not immediately. */
  setGain(peerId: string, gain: number): void {
    const peer = this.peers.get(peerId);
    if (peer) peer.targetGain = Math.min(1, Math.max(0, gain));
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
    if (muted && this.speaking) {
      this.speaking = false;
      this.callbacks.onSpeakingChange(false);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  getMicState(): MicState {
    return this.micState;
  }

  /** How loudly we currently hear a peer — used to fade their label. */
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
          peer.el.volume = peer.renderedGain;
        }
        continue;
      }
      peer.renderedGain += delta * k;
      peer.el.volume = Math.min(1, Math.max(0, peer.renderedGain));
    }
  }

  private setupVoiceDetection(): void {
    if (!this.localStream) return;
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(this.localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;

      // Connected to the analyser only. Never to ctx.destination — nothing is
      // played through this graph, which is what keeps AEC intact.
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

    // Hysteresis: a single threshold makes the ring flicker on every pause
    // between words.
    const next = this.speaking ? rms > SPEAKING_OFF : rms > SPEAKING_ON;
    if (next !== this.speaking) {
      this.speaking = next;
      this.callbacks.onSpeakingChange(next);
    }
  }
}
