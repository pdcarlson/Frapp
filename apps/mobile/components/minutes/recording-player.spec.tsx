/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEETING_RECORDER_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Playing a meeting back from its minutes (Paul, 2026-11-17): nothing loads
 * until Play, one control plays and pauses, and a build without audio
 * shows nothing.
 */
const native = vi.hoisted(() => ({
  available: true,
  listener: null as null | ((status: Record<string, unknown>) => void),
  player: { play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(), remove: vi.fn() },
  create: vi.fn(),
}));
vi.mock("@/lib/minutes/playback/player-module", () => ({
  requirePlayerModule: () =>
    native.available
      ? {
          setAudioModeAsync: () => Promise.resolve(),
          createAudioPlayer: (source: { uri: string }) => {
            native.create(source);
            return {
              ...native.player,
              addListener: (
                _event: string,
                listener: (status: Record<string, unknown>) => void,
              ) => {
                native.listener = listener;
                return { remove: vi.fn() };
              },
            };
          },
        }
      : null,
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

import { RecordingPlayer } from "./recording-player";

function player(url: string) {
  return (
    <FrappThemeProvider>
      <RecordingPlayer url={url} durationSeconds={2520} />
    </FrappThemeProvider>
  );
}
function render(url = "https://storage.test/a.aac"): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(player(url));
  });
  return tree;
}
const control = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )[0];

beforeEach(() => {
  vi.clearAllMocks();
  native.listener = null;
});

describe("RecordingPlayer", () => {
  it("loads nothing until Play, then plays and pauses from the same control", () => {
    const tree = render();
    expect(native.create).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("0:00 / 42:00");

    act(() => control(tree, MEETING_RECORDER_COPY.playAudio).props.onPress());
    expect(native.create).toHaveBeenCalledWith({
      uri: "https://storage.test/a.aac",
    });
    expect(native.player.play).toHaveBeenCalledTimes(1);

    act(() =>
      native.listener?.({
        playing: true,
        currentTime: 75,
        duration: 2519,
        isLoaded: true,
        didJustFinish: false,
      }),
    );
    expect(screenText(tree)).toContain("1:15 / 41:59");
    act(() => control(tree, MEETING_RECORDER_COPY.pauseAudio).props.onPress());
    expect(native.player.pause).toHaveBeenCalledTimes(1);
  });

  it("draws nothing where this build can't play audio", async () => {
    native.available = false;
    vi.resetModules();
    // The module is read once per app run; a fresh import reads it again.
    const { RecordingPlayer: Fresh } = await import("./recording-player");
    const { FrappThemeProvider: Theme } = await import("@/lib/theme");
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <Theme>
          <Fresh url="https://storage.test/a.aac" durationSeconds={60} />
        </Theme>,
      );
    });
    native.available = true;
    expect(tree.toJSON()).toBeNull();
  });

  it("takes up a fresh link at the next press after a pause, from the same place", () => {
    const tree = render("https://storage.test/a.aac?token=1");
    act(() => control(tree, MEETING_RECORDER_COPY.playAudio).props.onPress());
    act(() =>
      native.listener?.({
        playing: true,
        currentTime: 600,
        duration: 2519,
        isLoaded: true,
        didJustFinish: false,
      }),
    );
    act(() => control(tree, MEETING_RECORDER_COPY.pauseAudio).props.onPress());
    act(() =>
      native.listener?.({
        playing: false,
        currentTime: 600,
        duration: 2519,
        isLoaded: true,
        didJustFinish: false,
      }),
    );
    // The minutes were read again: the server signed a new link.
    act(() => tree.update(player("https://storage.test/a.aac?token=2")));
    act(() => control(tree, MEETING_RECORDER_COPY.playAudio).props.onPress());
    expect(native.player.remove).toHaveBeenCalledTimes(1);
    expect(native.create).toHaveBeenLastCalledWith({
      uri: "https://storage.test/a.aac?token=2",
    });
    expect(native.player.seekTo).toHaveBeenCalledWith(600);
  });

  it("says so when the audio never loads", () => {
    vi.useFakeTimers();
    try {
      const tree = render();
      act(() =>
        control(tree, MEETING_RECORDER_COPY.playAudio).props.onPress(),
      );
      act(() => vi.advanceTimersByTime(15_000));
      expect(native.player.remove).toHaveBeenCalledTimes(1);
      expect(screenText(tree)).toContain(MEETING_RECORDER_COPY.audioGone);
    } finally {
      vi.useRealTimers();
    }
  });
});
