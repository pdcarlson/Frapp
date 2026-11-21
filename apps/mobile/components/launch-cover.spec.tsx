import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import * as expoRouter from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { Platform } from "react-native";
import { useReducedMotion, withRepeat } from "react-native-reanimated";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLaunchGate, type LaunchGate } from "@/lib/launch/launch-gate";
import { EXIT_MS, EXIT_SCALE, LaunchCover } from "./launch-cover";

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

function render(gate: LaunchGate, appMounted = true): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<LaunchCover gate={gate} appMounted={appMounted} />);
  });
  return tree;
}

/** The emblem's drawn scale, as its animated style reads now. */
function emblemScale(tree: ReactTestRenderer): number {
  const emblem = tree.root.findByType("Animated.Image" as never);
  const styles = (emblem.props.style as object[]).flat() as Array<{
    transform?: Array<{ scale?: number }>;
  }>;
  // The animated style is a proxy that answers reads only, so look it up by one.
  const animated = styles.find((style) => style?.transform !== undefined);
  return animated?.transform?.[0]?.scale ?? 1;
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

  it("eases the emblem larger as it fades, but not with Reduce Motion", () => {
    const gate = gateWithManualClock();
    const tree = render(gate);
    // Wherever the breath was, the exit scales up from there (the suite's
    // timings land at once, so this is the end of each).
    const breathing = emblemScale(tree);
    act(() => gate.lift("ready"));
    expect(emblemScale(tree)).toBeCloseTo(breathing * (1 + EXIT_SCALE));

    vi.mocked(useReducedMotion).mockReturnValue(true);
    const stillGate = gateWithManualClock();
    const still = render(stillGate);
    act(() => stillGate.lift("ready"));
    expect(emblemScale(still)).toBe(1);
  });

  it("stays up until the app under it has mounted, even once the gate lifts", () => {
    const gate = gateWithManualClock();
    const tree = render(gate, false);
    act(() => gate.lift("cap"));
    act(() => vi.advanceTimersByTime(EXIT_MS * 2));
    expect(cover(tree)).not.toHaveLength(0);
    expect(cover(tree)[0]?.props.pointerEvents).toBe("auto");

    act(() => tree.update(<LaunchCover gate={gate} appMounted />));
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
