import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import * as expoRouter from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { Platform } from "react-native";
import { useReducedMotion, withRepeat } from "react-native-reanimated";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLaunchGate, type LaunchGate } from "@/lib/launch/launch-gate";
import { EXIT_MS, LaunchCover } from "./launch-cover";

// The splash PNG is a Metro asset id on a phone; vitest can't load the file.
vi.mock("@/lib/launch/launch-look", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/launch/launch-look")>()),
  launchEmblem: () => 1,
}));

const nav = expoRouter as unknown as {
  __setNavState: (state: object | undefined) => void;
};

function gateWithManualClock(): LaunchGate {
  // The cap and the settles never fire on their own here; a spec lifts it.
  return createLaunchGate({ schedule: () => () => {} });
}

function render(gate: LaunchGate): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<LaunchCover gate={gate} />);
  });
  return tree;
}

const cover = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => node.props.testID === "launch-cover");

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (run: () => void) =>
    setTimeout(run, 16),
  );
});

afterEach(() => {
  act(() => nav.__setNavState(undefined));
  Platform.OS = "ios";
  vi.mocked(useReducedMotion).mockReturnValue(false);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LaunchCover (#5449)", () => {
  it("covers the app with the splash's emblem, and hides the native splash only once it is drawn", () => {
    const tree = render(gateWithManualClock());
    expect(cover(tree)).not.toHaveLength(0);
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    const emblem = tree.root.findByType("Animated.Image" as never);
    expect(emblem.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: 200, height: 200 })]),
    );
    expect(emblem.props.fadeDuration).toBe(0);
    act(() => emblem.props.onLoad());
    act(() => vi.advanceTimersByTime(16));
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  it("breathes while it waits, and holds still with Reduce Motion", () => {
    render(gateWithManualClock());
    expect(withRepeat).toHaveBeenCalled();

    vi.mocked(withRepeat).mockClear();
    vi.mocked(useReducedMotion).mockReturnValue(true);
    render(gateWithManualClock());
    expect(withRepeat).not.toHaveBeenCalled();
  });

  it("fades out when the gate lifts, lets touches through, and then leaves", () => {
    const gate = gateWithManualClock();
    const tree = render(gate);
    expect(cover(tree)[0]?.props.pointerEvents).toBe("auto");

    act(() => gate.lift("ready"));
    expect(cover(tree)[0]?.props.pointerEvents).toBe("none");
    expect(SplashScreen.hideAsync).toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(cover(tree)).toHaveLength(0);
  });

  it("tells the gate when a screen is in front", () => {
    const gate = gateWithManualClock();
    const setLanded = vi.spyOn(gate, "setLanded");
    render(gate);
    expect(setLanded).toHaveBeenLastCalledWith(false);

    act(() =>
      nav.__setNavState({
        index: 0,
        routes: [
          {
            name: "__root",
            state: {
              index: 0,
              routes: [
                { name: "(auth)", state: { index: 0, routes: [{ name: "sign-in" }] } },
              ],
            },
          },
        ],
      }),
    );
    expect(setLanded).toHaveBeenLastCalledWith(true);
  });

  it("draws nothing on the web build, and lifts the gate there at once", () => {
    Platform.OS = "web" as typeof Platform.OS;
    const gate = gateWithManualClock();
    const tree = render(gate);
    expect(tree.toJSON()).toBeNull();
    expect(gate.lifted()).toBe("now");
  });
});
