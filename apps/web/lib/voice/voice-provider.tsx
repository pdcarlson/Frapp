"use client";

/**
 * The voice prototype's app-wide state (#3866). See `flag.ts`.
 *
 * Mounted once by the dashboard shell, so the call survives moving between
 * chat channels and tool pages: the bar at the bottom of the nav reads it, the
 * channel header joins through it, and the channel list shows who is in.
 *
 * One Realtime topic at a time, `voice:<channelId>`: the room you are in, or,
 * while you are in none, the channel you are looking at (so its header can say
 * "2 in voice" before you join). Presence on that topic is the room's roster;
 * broadcasts on it carry the WebRTC signalling. The topic is private, so its
 * `realtime.messages` policy only admits people who can read the channel (the
 * prototype's migration adds the `voice:` arm). It is a topic of its own, never
 * `chat:channel:<id>`, which the push worker reads (realtime-resilience
 * rule 2), and it attaches through the shared topic queue (rule 1).
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useViewerUserId } from "@repo/hooks";
import { attachRealtimeChannel } from "@/lib/realtime/supabase-realtime";
import { VOICE_PROTOTYPE_ENABLED } from "@/lib/voice/flag";
import {
  createLevelMeter,
  isSignalFor,
  nextSpeaking,
  VoiceMesh,
  type VoiceSignal,
} from "@/lib/voice/voice-mesh";

export type VoiceParticipant = {
  peerId: string;
  userId: string;
  muted: boolean;
  joinedAt: number;
};

type Joined = { channelId: string; channelName: string };

export type VoiceState = {
  enabled: boolean;
  selfPeerId: string;
  /** The room you are in, if any. */
  joined: Joined | null;
  status: "idle" | "connecting" | "live";
  error: string | null;
  localMuted: boolean;
  /** The channel whose room this state describes (joined, else viewed). */
  observedChannelId: string | null;
  /** Who is in the observed room, you included once you join. */
  participants: VoiceParticipant[];
  /** Peer ids talking right now, you included. */
  speaking: ReadonlySet<string>;
  /** Peers whose audio is actually arriving. */
  connectedPeers: ReadonlySet<string>;
  setViewedChannel: (channelId: string | null) => void;
  join: (channelId: string, channelName: string) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
};

const noop = () => {};
const EMPTY = new Set<string>();
const DISABLED: VoiceState = {
  enabled: false,
  selfPeerId: "",
  joined: null,
  status: "idle",
  error: null,
  localMuted: false,
  observedChannelId: null,
  participants: [],
  speaking: EMPTY,
  connectedPeers: EMPTY,
  setViewedChannel: noop,
  join: async () => {},
  leave: noop,
  toggleMute: noop,
};

const VoiceContext = createContext<VoiceState>(DISABLED);

export function useVoice(): VoiceState {
  return useContext(VoiceContext);
}

/** Optional STUN/TURN servers as JSON; empty works on one machine. */
function iceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_VOICE_ICE_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RTCIceServer[]) : [];
  } catch {
    return [];
  }
}

function rosterFrom(channel: RealtimeChannel): VoiceParticipant[] {
  const state = channel.presenceState<Partial<VoiceParticipant>>();
  const byPeer = new Map<string, VoiceParticipant>();
  for (const metas of Object.values(state)) {
    for (const meta of metas) {
      if (typeof meta.peerId !== "string" || typeof meta.userId !== "string") {
        continue;
      }
      byPeer.set(meta.peerId, {
        peerId: meta.peerId,
        userId: meta.userId,
        muted: meta.muted === true,
        joinedAt: typeof meta.joinedAt === "number" ? meta.joinedAt : 0,
      });
    }
  }
  return [...byPeer.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  if (!VOICE_PROTOTYPE_ENABLED) return <>{children}</>;
  return <VoiceProviderInner>{children}</VoiceProviderInner>;
}

function VoiceProviderInner({ children }: { children: ReactNode }) {
  const userId = useViewerUserId();
  // One id per tab, so two tabs signed in as the same person are two peers.
  const [selfPeerId] = useState(() => crypto.randomUUID());

  const [viewedChannelId, setViewedChannelId] = useState<string | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [status, setStatus] = useState<VoiceState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [localMuted, setLocalMuted] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(EMPTY);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(
    () => new Map(),
  );

  const observedChannelId = joined?.channelId ?? viewedChannelId;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const meshRef = useRef<VoiceMesh | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const joinedRef = useRef<Joined | null>(null);
  const mutedRef = useRef(false);
  const joinedAtRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  const trackSelf = useCallback(
    (channel: RealtimeChannel | null) => {
      if (!channel || !joinedRef.current || !userId) return;
      void channel.track({
        peerId: selfPeerId,
        userId,
        muted: mutedRef.current,
        joinedAt: joinedAtRef.current,
      });
    },
    [selfPeerId, userId],
  );

  // The room's topic: attach on change, release on cleanup, through the queue.
  useEffect(() => {
    // Nothing to observe; the previous room's cleanup already cleared it.
    if (!observedChannelId) return;
    const topic = `voice:${observedChannelId}`;
    const release = attachRealtimeChannel(
      topic,
      (channel) =>
        channel
          .on("presence", { event: "sync" }, () => {
            const roster = rosterFrom(channel);
            setParticipants(roster);
            meshRef.current?.syncPeers(roster.map((p) => p.peerId));
          })
          .on("broadcast", { event: "signal" }, ({ payload }) => {
            if (isSignalFor(selfPeerId, payload)) {
              void meshRef.current?.handleSignal(payload);
            }
          }),
      {
        private: true,
        onSubscribed: (channel) => {
          channelRef.current = channel;
          // Re-sent on every (re)join, or a reconnect drops you from the roster.
          trackSelf(channel);
        },
        onDisconnected: () => {
          // The roster we hold is no longer current; don't show it as fact.
          setParticipants([]);
        },
      },
    );
    return () => {
      channelRef.current = null;
      setParticipants([]);
      release();
    };
  }, [observedChannelId, selfPeerId, trackSelf]);

  const teardown = useCallback(() => {
    meshRef.current?.close();
    meshRef.current = null;
    for (const track of localStreamRef.current?.getTracks() ?? []) track.stop();
    localStreamRef.current = null;
    joinedRef.current = null;
    setRemoteStreams(new Map());
    setSpeaking(EMPTY);
  }, []);

  const leave = useCallback(() => {
    void channelRef.current?.untrack();
    teardown();
    setJoined(null);
    setStatus("idle");
    setLocalMuted(false);
    mutedRef.current = false;
  }, [teardown]);

  const join = useCallback(
    async (channelId: string, channelName: string) => {
      if (!userId) return;
      if (joinedRef.current) leave();
      setError(null);
      setStatus("connecting");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch (cause) {
        setStatus("idle");
        setError(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "Frapp needs your microphone for voice. Allow it in the browser and try again."
            : "Couldn't start your microphone.",
        );
        return;
      }
      localStreamRef.current = stream;
      mutedRef.current = false;
      setLocalMuted(false);
      joinedAtRef.current = Date.now();
      const next = { channelId, channelName };
      joinedRef.current = next;
      meshRef.current = new VoiceMesh({
        selfId: selfPeerId,
        localStream: stream,
        iceServers: iceServers(),
        send: (signal: VoiceSignal) => {
          void channelRef.current?.send({
            type: "broadcast",
            event: "signal",
            payload: signal,
          });
        },
        onRemoteStream: (peerId, remote) =>
          setRemoteStreams((prev) => new Map(prev).set(peerId, remote)),
        onPeerClosed: (peerId) =>
          setRemoteStreams((prev) => {
            const copy = new Map(prev);
            copy.delete(peerId);
            return copy;
          }),
      });
      setJoined(next);
      setStatus("live");
      // Same topic as the one we were peeking: track now. A different topic
      // attaches on the next render and tracks from `onSubscribed`.
      if (channelId === observedChannelId) trackSelf(channelRef.current);
    },
    [leave, observedChannelId, selfPeerId, trackSelf, userId],
  );

  const toggleMute = useCallback(() => {
    const muted = !mutedRef.current;
    mutedRef.current = muted;
    setLocalMuted(muted);
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
    trackSelf(channelRef.current);
  }, [trackSelf]);

  // Leaving the page leaves the room. `pagehide` untracks at once, so the
  // others don't keep seeing you until presence notices the socket is gone.
  useEffect(() => {
    const onPageHide = () => {
      if (joinedRef.current) void channelRef.current?.untrack();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      teardown();
    };
  }, [teardown]);

  // Who is talking: sample every stream's loudness a few times a second.
  useEffect(() => {
    if (!joined) return;
    const context = (audioContextRef.current ??= new AudioContext());
    void context.resume();
    const meters = new Map<string, ReturnType<typeof createLevelMeter>>();
    const local = localStreamRef.current;
    if (local) meters.set(selfPeerId, createLevelMeter(context, local));
    for (const [peerId, stream] of remoteStreams) {
      meters.set(peerId, createLevelMeter(context, stream));
    }
    const lastLoud = new Map<string, number | undefined>();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const talking = new Set<string>();
      for (const [peerId, meter] of meters) {
        const level =
          peerId === selfPeerId && mutedRef.current ? 0 : meter.read();
        const next = nextSpeaking(lastLoud.get(peerId), level, now);
        lastLoud.set(peerId, next.lastLoudAt);
        if (next.speaking) talking.add(peerId);
      }
      setSpeaking((prev) =>
        prev.size === talking.size && [...talking].every((id) => prev.has(id))
          ? prev
          : talking,
      );
    }, 100);
    return () => {
      window.clearInterval(timer);
      for (const meter of meters.values()) meter.dispose();
    };
  }, [joined, remoteStreams, selfPeerId]);

  const connectedPeers = useMemo(
    () => new Set(remoteStreams.keys()) as ReadonlySet<string>,
    [remoteStreams],
  );

  const value = useMemo<VoiceState>(
    () => ({
      enabled: true,
      selfPeerId,
      joined,
      status,
      error,
      localMuted,
      observedChannelId,
      participants,
      speaking,
      connectedPeers,
      setViewedChannel: setViewedChannelId,
      join,
      leave,
      toggleMute,
    }),
    [
      selfPeerId,
      joined,
      status,
      error,
      localMuted,
      observedChannelId,
      participants,
      speaking,
      connectedPeers,
      join,
      leave,
      toggleMute,
    ],
  );

  return (
    <VoiceContext.Provider value={value}>
      {children}
      {/* The other people's audio. Hidden: the bar is the only call UI. */}
      <div hidden aria-hidden>
        {[...remoteStreams].map(([peerId, stream]) => (
          <RemoteAudio key={peerId} stream={stream} />
        ))}
      </div>
    </VoiceContext.Provider>
  );
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    void element.play().catch(() => {});
    return () => {
      element.srcObject = null;
    };
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}
