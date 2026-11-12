/**
 * The voice prototype's peer-to-peer mesh (#3866). See `flag.ts`.
 *
 * Every person in a room holds one `RTCPeerConnection` to every other person
 * and sends them their microphone directly. That is fine for a handful of
 * people on decent networks, and it is exactly what a real build would replace
 * with a media server (an SFU), where each person sends one stream up and the
 * server fans it out. Nothing here is recorded or stored.
 *
 * Signalling (the offer, answer and network candidates two browsers trade
 * before audio flows) goes out through `send`, which the provider wires to a
 * Realtime broadcast on the room's topic. Messages are addressed to one peer;
 * everyone else on the topic ignores them.
 *
 * Who offers: of any two peers, the one whose id sorts first. Only one side
 * ever makes the offer, so two peers never offer to each other at once
 * ("glare") and there is no rollback to handle.
 */

export type VoiceSignal = {
  from: string;
  to: string;
  kind: "offer" | "answer" | "ice";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export type VoiceMeshOptions = {
  selfId: string;
  localStream: MediaStream;
  send: (signal: VoiceSignal) => void;
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onPeerClosed: (peerId: string) => void;
  iceServers?: RTCIceServer[];
  /** Injected in tests; the browser's own constructor otherwise. */
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
};

/** Of two peers, the one that sends the offer. */
export function shouldOffer(selfId: string, peerId: string): boolean {
  return selfId < peerId;
}

/** Whether a broadcast signal is for this peer and well-formed. */
export function isSignalFor(selfId: string, value: unknown): value is VoiceSignal {
  if (!value || typeof value !== "object") return false;
  const signal = value as Partial<VoiceSignal>;
  return (
    signal.to === selfId &&
    typeof signal.from === "string" &&
    signal.from !== selfId &&
    (signal.kind === "offer" || signal.kind === "answer" || signal.kind === "ice")
  );
}

type Peer = {
  pc: RTCPeerConnection;
  /** Candidates that arrived before the remote description was set. */
  pendingIce: RTCIceCandidateInit[];
};

export class VoiceMesh {
  private readonly peers = new Map<string, Peer>();
  private closed = false;
  private lastRoster: string[] = [];

  constructor(private readonly options: VoiceMeshOptions) {}

  /** The peers this mesh currently holds a connection to. */
  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  /**
   * Bring the connections in line with who is in the room: connect to anyone
   * new (offering when this side should), and drop anyone who left.
   */
  syncPeers(roster: readonly string[]): void {
    if (this.closed) return;
    this.lastRoster = roster.filter((id) => id !== this.options.selfId);
    const wanted = new Set(this.lastRoster);
    for (const peerId of [...this.peers.keys()]) {
      if (!wanted.has(peerId)) this.drop(peerId);
    }
    for (const peerId of wanted) {
      if (this.peers.has(peerId)) continue;
      if (shouldOffer(this.options.selfId, peerId)) void this.offerTo(peerId);
      // Otherwise wait: that peer offers to us, and `handleSignal` connects.
    }
  }

  async handleSignal(signal: VoiceSignal): Promise<void> {
    if (this.closed || signal.to !== this.options.selfId) return;
    try {
      if (signal.kind === "offer" && signal.sdp) {
        // A fresh offer replaces whatever we held for that peer: it rejoined.
        if (this.peers.has(signal.from)) this.drop(signal.from, false);
        const peer = this.connect(signal.from);
        await peer.pc.setRemoteDescription(signal.sdp);
        await this.flushIce(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.options.send({
          from: this.options.selfId,
          to: signal.from,
          kind: "answer",
          sdp: peer.pc.localDescription?.toJSON() ?? answer,
        });
        return;
      }
      const peer = this.peers.get(signal.from);
      if (!peer) return;
      if (signal.kind === "answer" && signal.sdp) {
        if (peer.pc.signalingState !== "have-local-offer") return;
        await peer.pc.setRemoteDescription(signal.sdp);
        await this.flushIce(peer);
        return;
      }
      if (signal.kind === "ice" && signal.candidate) {
        if (peer.pc.remoteDescription) {
          await peer.pc.addIceCandidate(signal.candidate);
        } else {
          peer.pendingIce.push(signal.candidate);
        }
      }
    } catch (error) {
      console.warn(`voice: signal ${signal.kind} from ${signal.from} failed`, error);
    }
  }

  /**
   * Swap the microphone under every live connection (a new device, or new
   * processing settings) without renegotiating.
   */
  replaceLocalStream(stream: MediaStream): void {
    const track = stream.getAudioTracks()[0] ?? null;
    (this.options as { localStream: MediaStream }).localStream = stream;
    for (const { pc } of this.peers.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind === "audio" || sender.track === null) {
          void sender.replaceTrack(track);
        }
      }
    }
  }

  close(): void {
    this.closed = true;
    for (const peerId of [...this.peers.keys()]) this.drop(peerId);
  }

  private connect(peerId: string): Peer {
    const create =
      this.options.createPeerConnection ??
      ((config: RTCConfiguration) => new RTCPeerConnection(config));
    const pc = create({ iceServers: this.options.iceServers ?? [] });
    const peer: Peer = { pc, pendingIce: [] };
    this.peers.set(peerId, peer);

    for (const track of this.options.localStream.getAudioTracks()) {
      pc.addTrack(track, this.options.localStream);
    }
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.options.send({
        from: this.options.selfId,
        to: peerId,
        kind: "ice",
        candidate: event.candidate.toJSON(),
      });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.options.onRemoteStream(peerId, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== "failed") return;
      // A dead link: drop it, then reconnect if they are still in the room.
      this.drop(peerId);
      this.syncPeers(this.lastRoster);
    };
    return peer;
  }

  private async offerTo(peerId: string): Promise<void> {
    const peer = this.connect(peerId);
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.options.send({
        from: this.options.selfId,
        to: peerId,
        kind: "offer",
        sdp: peer.pc.localDescription?.toJSON() ?? offer,
      });
    } catch (error) {
      console.warn(`voice: offer to ${peerId} failed`, error);
      this.drop(peerId);
    }
  }

  private async flushIce(peer: Peer): Promise<void> {
    const queued = peer.pendingIce.splice(0);
    for (const candidate of queued) {
      await peer.pc.addIceCandidate(candidate);
    }
  }

  private drop(peerId: string, notify = true): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    if (notify) this.options.onPeerClosed(peerId);
  }
}

/**
 * A speaking detector for one audio stream: returns its loudness (RMS, 0..1)
 * each time it is called. The analyser taps the stream; it plays nothing.
 */
export function createLevelMeter(
  context: AudioContext,
  stream: MediaStream,
): { read: () => number; dispose: () => void } {
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  return {
    read() {
      analyser.getFloatTimeDomainData(buffer);
      return rms(buffer);
    },
    dispose() {
      source.disconnect();
    },
  };
}

export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/** Loudness above which a person counts as talking. */
export const SPEAKING_THRESHOLD = 0.02;
/** How long the ring stays lit after they stop, so it doesn't flicker between words. */
export const SPEAKING_HOLD_MS = 350;

/**
 * Turns per-tick loudness into a steady "is talking" signal: on as soon as a
 * reading crosses the threshold, off only after `SPEAKING_HOLD_MS` of quiet.
 */
export function nextSpeaking(
  lastLoudAt: number | undefined,
  level: number,
  now: number,
): { speaking: boolean; lastLoudAt: number | undefined } {
  if (level >= SPEAKING_THRESHOLD) return { speaking: true, lastLoudAt: now };
  if (lastLoudAt !== undefined && now - lastLoudAt < SPEAKING_HOLD_MS) {
    return { speaking: true, lastLoudAt };
  }
  return { speaking: false, lastLoudAt };
}
