import { describe, expect, it, vi } from "vitest";
import {
  isSignalFor,
  nextSpeaking,
  rms,
  shouldOffer,
  SPEAKING_HOLD_MS,
  SPEAKING_THRESHOLD,
  VoiceMesh,
} from "./voice-mesh";

describe("shouldOffer", () => {
  it("makes exactly one of two peers the offerer", () => {
    expect(shouldOffer("a", "b")).toBe(true);
    expect(shouldOffer("b", "a")).toBe(false);
  });
});

describe("isSignalFor", () => {
  it("accepts only well-formed signals addressed to this peer", () => {
    expect(isSignalFor("me", { from: "x", to: "me", kind: "offer" })).toBe(true);
    expect(isSignalFor("me", { from: "x", to: "you", kind: "offer" })).toBe(false);
    expect(isSignalFor("me", { from: "me", to: "me", kind: "ice" })).toBe(false);
    expect(isSignalFor("me", { from: "x", to: "me", kind: "hello" })).toBe(false);
    expect(isSignalFor("me", null)).toBe(false);
  });
});

describe("speaking", () => {
  it("measures loudness", () => {
    expect(rms([])).toBe(0);
    expect(rms([0.5, -0.5])).toBeCloseTo(0.5);
  });

  it("lights at once and holds through a short pause", () => {
    const loud = nextSpeaking(undefined, SPEAKING_THRESHOLD, 1000);
    expect(loud.speaking).toBe(true);
    const pause = nextSpeaking(loud.lastLoudAt, 0, 1000 + SPEAKING_HOLD_MS - 1);
    expect(pause.speaking).toBe(true);
    const quiet = nextSpeaking(loud.lastLoudAt, 0, 1000 + SPEAKING_HOLD_MS);
    expect(quiet.speaking).toBe(false);
  });
});

describe("VoiceMesh.syncPeers", () => {
  function fakePc() {
    return {
      addTrack: vi.fn(),
      createOffer: vi.fn(async () => ({ type: "offer", sdp: "o" })),
      setLocalDescription: vi.fn(async () => {}),
      localDescription: null,
      close: vi.fn(),
    } as unknown as RTCPeerConnection;
  }

  it("offers only to peers that sort after it, and drops peers who left", async () => {
    const send = vi.fn();
    const onPeerClosed = vi.fn();
    const created: RTCPeerConnection[] = [];
    const mesh = new VoiceMesh({
      selfId: "m",
      localStream: { getAudioTracks: () => [] } as unknown as MediaStream,
      send,
      onRemoteStream: vi.fn(),
      onPeerClosed,
      createPeerConnection: () => {
        const pc = fakePc();
        created.push(pc);
        return pc;
      },
    });
    mesh.syncPeers(["a", "m", "z"]);
    await Promise.resolve();
    await Promise.resolve();
    // "a" sorts first, so "a" offers to us; we offer to "z" only.
    expect(mesh.peerIds()).toEqual(["z"]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "m", to: "z", kind: "offer" }),
    );
    mesh.syncPeers(["a", "m"]);
    expect(mesh.peerIds()).toEqual([]);
    expect(created[0]!.close).toHaveBeenCalled();
    expect(onPeerClosed).toHaveBeenCalledWith("z");
  });
});
