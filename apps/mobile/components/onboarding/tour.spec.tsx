/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: "SafeAreaProvider",
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));
const track = vi.fn();
vi.mock("@/lib/use-latest-track", () => ({ useLatestTrack: () => track }));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentUser: () => ({ data: { id: "u-1" } }),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { BackHandler, View } from "react-native";
import { TourHost, spotlightPath, useTourAnchor, useTourReady } from "./tour";
import { TOUR_DUE_STORAGE_KEY, type TourStopKey } from "@/lib/onboarding/tour";

type Node = ReactTestRenderer["root"];

/** Where each anchored control sits in the window, by its testID. */
const RECTS: Record<string, [number, number, number, number]> = {
  "anchor-channels": [0, 220, 390, 600],
  "anchor-quickActions": [314, 748, 62, 62],
  "anchor-more": [230, 754, 70, 50],
};

function Anchor({ stop }: { stop: TourStopKey }) {
  const ref = useTourAnchor(stop);
  return <View ref={ref} testID={`anchor-${stop}`} />;
}

function ChatHome({ withChannels }: { withChannels: boolean }) {
  // The chapter's name arrives a moment after the list, as it can on device:
  // the tour must still start, with the name.
  const [name, setName] = React.useState<string | null>(null);
  React.useEffect(() => {
    const timer = setTimeout(() => setName("Phi Gamma Delta"), 50);
    return () => clearTimeout(timer);
  }, []);
  useTourReady(true, name);
  return (
    <>
      {withChannels ? <Anchor stop="channels" /> : null}
      <Anchor stop="quickActions" />
      <Anchor stop="more" />
    </>
  );
}

async function render(withChannels = true): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <TourHost>
          <ChatHome withChannels={withChannels} />
        </TourHost>
      </FrappThemeProvider>,
      {
        createNodeMock: (element) => ({
          measureInWindow: (
            callback: (x: number, y: number, w: number, h: number) => void,
          ) => {
            const testID = (element.props as { testID?: string }).testID;
            const rect = (testID && RECTS[testID]) || [0, 0, 390, 844];
            callback(...rect);
          },
        }),
      },
    );
  });
  // The due read, then the host's settle delay before it measures.
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }
  return tree;
}

const overlay = (root: Node) =>
  root.findAll((node) => node.props.testID === "tour-overlay");

const texts = (root: Node) =>
  root
    .findAllByType("Text" as never, { deep: true })
    .map((text) => String(text.props.children ?? ""));

const buttonLabelled = (root: Node, label: string) =>
  root
    .findAllByType("Pressable" as never, { deep: true })
    .find((pressable) => pressable.props.accessibilityLabel === label);

async function press(target: Node | undefined) {
  await act(async () => {
    target?.props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The suite's AsyncStorage is a stub; this spec needs one that remembers. */
const stored = new Map<string, string>();
beforeEach(() => {
  track.mockClear();
  stored.clear();
  vi.mocked(AsyncStorage.getItem).mockImplementation(
    async (key: string) => stored.get(key) ?? null,
  );
  vi.mocked(AsyncStorage.setItem).mockImplementation(
    async (key: string, value: string) => {
      stored.set(key, value);
    },
  );
  vi.mocked(AsyncStorage.removeItem).mockImplementation(async (key: string) => {
    stored.delete(key);
  });
});

describe("first-run tour", () => {
  it("never starts for a member s03 didn't mark it for", async () => {
    const { root } = await render();
    expect(overlay(root)).toHaveLength(0);
  });

  it("walks the three stops, then never shows again", async () => {
    await AsyncStorage.setItem(TOUR_DUE_STORAGE_KEY, "u-1");
    const { root } = await render();

    expect(overlay(root).length).toBeGreaterThan(0);
    expect(texts(root)).toContain(
      "You're in Phi Gamma Delta. Tap a channel to start talking.",
    );
    expect(texts(root)).toContain("1 of 3");

    await press(buttonLabelled(root, "Next"));
    expect(texts(root)).toContain(
      "Shortcuts live under the +. Hold it to pick your own.",
    );
    await press(buttonLabelled(root, "Next"));
    expect(texts(root)).toContain("3 of 3");
    expect(buttonLabelled(root, "Done")).toBeDefined();
    await press(buttonLabelled(root, "Done"));

    expect(overlay(root)).toHaveLength(0);
    expect(await AsyncStorage.getItem(TOUR_DUE_STORAGE_KEY)).toBeNull();
    expect(track).toHaveBeenCalledWith("onboarding-tour-finished", {
      outcome: "done",
      stop: 3,
      stops: 3,
    });
  });

  it("ends on Skip, wherever the member is", async () => {
    await AsyncStorage.setItem(TOUR_DUE_STORAGE_KEY, "u-1");
    const { root } = await render();

    await press(buttonLabelled(root, "Skip the tour"));

    expect(overlay(root)).toHaveLength(0);
    expect(await AsyncStorage.getItem(TOUR_DUE_STORAGE_KEY)).toBeNull();
    expect(track).toHaveBeenCalledWith("onboarding-tour-finished", {
      outcome: "skipped",
      stop: 1,
      stops: 3,
    });
  });

  it("skips a stop whose control isn't on screen", async () => {
    await AsyncStorage.setItem(TOUR_DUE_STORAGE_KEY, "u-1");
    const { root } = await render(false);

    expect(texts(root)).toContain("1 of 2");
    expect(texts(root)).toContain(
      "Shortcuts live under the +. Hold it to pick your own.",
    );
  });

  it("steps back on Android back, and skips from the first stop", async () => {
    await AsyncStorage.setItem(TOUR_DUE_STORAGE_KEY, "u-1");
    const listen = vi.mocked(BackHandler.addEventListener);
    listen.mockClear();
    const { root } = await render();
    const back = () => {
      const calls = listen.mock.calls as unknown as [string, () => boolean][];
      const handler = calls.filter(([e]) => e === "hardwareBackPress").at(-1);
      let handled = false;
      act(() => {
        handled = handler![1]();
      });
      return handled;
    };

    await press(buttonLabelled(root, "Next"));
    expect(back()).toBe(true);
    expect(texts(root)).toContain("1 of 3");
    expect(back()).toBe(true);
    expect(overlay(root)).toHaveLength(0);
  });
});

describe("spotlightPath", () => {
  it("cuts one rounded hole out of the full window", () => {
    const path = spotlightPath(390, 844, {
      x: 10,
      y: 20,
      width: 100,
      height: 40,
    });
    expect(path.startsWith("M0 0H390V844H0Z")).toBe(true);
    expect(path).toContain("M24 20H96");
    expect(path.match(/A14 14/g)).toHaveLength(4);
  });
});
