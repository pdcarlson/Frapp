/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MESSAGES_HINT_REPEAT_MS,
  MESSAGES_PEEK,
} from "@/lib/chat/messages-hint";
import { holdOverlay } from "@/lib/overlay-presence";
import { TOUR_DUE_STORAGE_KEY } from "@/lib/onboarding/tour";
import { FrappThemeProvider } from "@/lib/theme";
import {
  MessagesSwipeArea,
  type MessagesSwipeHint,
} from "./messages-swipe-area";

/**
 * #3774, #4610 step 3: the screen gives under a slide toward Messages, and a
 * hint teaches the slide once. `lib/chat/messages-hint.spec.ts` has the rule
 * for when; this is what the area draws and records.
 */

const HINT_KEY = "frapp.mobile.messages-swipe-hint:u-1";

type Pan = {
  handlers: Record<string, (event: unknown, success?: boolean) => void>;
};

const stored = new Map<string, string>();
const mounted: ReactTestRenderer[] = [];

function element(hint: Partial<MessagesSwipeHint> | null, enabled: boolean) {
  return (
    <FrappThemeProvider>
      <MessagesSwipeArea
        enabled={enabled}
        hint={
          hint
            ? {
                viewerId: "u-1",
                ready: true,
                unreadConversations: 0,
                ...hint,
              }
            : undefined
        }
      >
        <View testID="chat-home" />
      </MessagesSwipeArea>
    </FrappThemeProvider>
  );
}

function render(hint: Partial<MessagesSwipeHint> | null = {}, enabled = true) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element(hint, enabled));
  });
  mounted.push(tree);
  return tree;
}

const pan = (tree: ReactTestRenderer) =>
  tree.root.findByType("GestureDetector" as unknown as React.ElementType).props
    .gesture as Pan;

const byTestId = (tree: ReactTestRenderer, id: string, type: string) =>
  tree.root.findAll(
    (node) => node.props.testID === id && (node.type as unknown) === type,
  )[0]!;

/** How far the screen is moved aside, read as the UI thread would. */
const offset = (tree: ReactTestRenderer) => {
  const screen = byTestId(tree, "messages-swipe-screen", "Animated.View");
  const [, slide] = screen.props.style as [
    unknown,
    { transform: { translateX: number }[] },
  ];
  return slide.transform[0]!.translateX;
};

/** The area's own touch events: a finger down anywhere on it, and up. */
const area = (tree: ReactTestRenderer) =>
  byTestId(tree, "messages-swipe-area", "View").props as {
    onTouchStart: () => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };

const record = () =>
  stored.has(HINT_KEY)
    ? (JSON.parse(stored.get(HINT_KEY)!) as {
        swiped: boolean;
        shown: number;
        lastShownAt: number | null;
      })
    : null;

const labelOpacity = (tree: ReactTestRenderer) => {
  const label = tree.root.findAll(
    (node) =>
      node.props.testID === "messages-hint" &&
      (node.type as unknown) === "Animated.View",
  )[0];
  if (!label) return null;
  return (label.props.style as [unknown, { opacity: number }])[1].opacity;
};

/** Lets the rest timer fire and the storage reads behind it settle. */
async function rest(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  stored.clear();
  vi.mocked(AsyncStorage.getItem).mockImplementation(
    async (key: string) => stored.get(key) ?? null,
  );
  vi.mocked(AsyncStorage.setItem).mockImplementation(
    async (key: string, value: string) => {
      stored.set(key, value);
    },
  );
  vi.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(false);
  vi.mocked(useReducedMotion).mockReturnValue(false);
  vi.mocked(vi.mocked(useRouter)().push).mockClear();
});

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  vi.useRealTimers();
});

describe("the screen gives under a slide toward Messages", () => {
  it("moves with the finger once the pan takes over, and settles on release", () => {
    const tree = render(null);
    expect(offset(tree)).toBe(0);
    act(() => pan(tree).handlers.onBegin!({}));
    // On a phone gesture-handler zeroes the translation as the pan takes over.
    act(() => pan(tree).handlers.onStart!({ translationX: 0 }));
    act(() => pan(tree).handlers.onUpdate!({ translationX: -50 }));
    expect(offset(tree)).toBe(-30);
    act(() => pan(tree).handlers.onFinalize!({}, true));
    expect(offset(tree)).toBe(0);
  });

  it("counts the travel from where the pan took over, where the translation isn't zeroed", () => {
    const tree = render(null);
    act(() => pan(tree).handlers.onBegin!({}));
    act(() => pan(tree).handlers.onStart!({ translationX: -24 }));
    act(() => pan(tree).handlers.onUpdate!({ translationX: -24 }));
    expect(offset(tree)).toBe(0);
    act(() => pan(tree).handlers.onUpdate!({ translationX: -74 }));
    expect(offset(tree)).toBe(-30);
  });

  it("takes the pan on the whole area, so a slide from the uncovered strip counts", () => {
    const tree = render(null);
    const detector = tree.root.findByType(
      "GestureDetector" as unknown as React.ElementType,
    );
    expect(
      (detector.children[0] as ReactTestRenderer["root"]).props.testID,
    ).toBe("messages-swipe-area");
  });

  it("draws the edge of Messages behind the screen, hidden from screen readers", () => {
    const edge = render(null).root.findAll(
      (node) =>
        node.props.testID === "messages-edge" &&
        (node.type as unknown) === "View",
    )[0]!;
    expect(edge.props.accessibilityElementsHidden).toBe(true);
    expect(edge.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(edge.props.pointerEvents).toBe("none");
  });
});

describe("the hint that teaches the swipe", () => {
  it("plays once Chat home has rested: the screen slides aside, the label shows, and it settles back", async () => {
    const tree = render();
    expect(labelOpacity(tree)).toBe(0);
    await rest(1100);
    expect(offset(tree)).toBe(0);
    await rest(200);
    expect(offset(tree)).toBe(-MESSAGES_PEEK);
    expect(labelOpacity(tree)).toBe(1);
    // Remembered before it plays, so it can't play twice.
    expect(record()).toMatchObject({ swiped: false, shown: 1 });
    await rest(2000);
    expect(offset(tree)).toBe(0);
    expect(labelOpacity(tree)).toBe(0);
  });

  it("says its words on a label a screen reader never meets", async () => {
    const tree = render();
    const label = tree.root.findAll(
      (node) => node.props.testID === "messages-hint",
    )[0]!;
    expect(
      label.findByType("Text" as unknown as React.ElementType).props.children,
    ).toBe("Swipe left for Messages");
    expect(label.props.accessibilityElementsHidden).toBe(true);
    expect(label.props.pointerEvents).toBe("none");
  });

  it("does not play again on the next visit", async () => {
    stored.set(
      HINT_KEY,
      JSON.stringify({ swiped: false, shown: 1, lastShownAt: Date.now() }),
    );
    const tree = render();
    await rest(3000);
    expect(offset(tree)).toBe(0);
    expect(labelOpacity(tree)).toBe(0);
  });

  it("never plays for a member who has swiped to Messages", async () => {
    stored.set(
      HINT_KEY,
      JSON.stringify({ swiped: true, shown: 0, lastShownAt: null }),
    );
    const tree = render({ unreadConversations: 3 });
    await rest(3000);
    expect(labelOpacity(tree)).toBe(0);
  });

  it("shows only the label with Reduce Motion on", async () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    const tree = render();
    await rest(1300);
    expect(labelOpacity(tree)).toBe(1);
    expect(offset(tree)).toBe(0);
  });

  it("stays quiet while a screen reader is on, and does not spend its one showing", async () => {
    vi.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
    const tree = render();
    await rest(3000);
    expect(labelOpacity(tree)).toBe(0);
    expect(stored.has(HINT_KEY)).toBe(false);
  });

  it("waits for the first-run tour, which teaches the same thing", async () => {
    stored.set(TOUR_DUE_STORAGE_KEY, "u-1");
    const tree = render();
    await rest(3000);
    expect(labelOpacity(tree)).toBe(0);
    expect(stored.has(HINT_KEY)).toBe(false);
  });

  it("waits while Chat home is not at rest: loading, or a menu open over it", async () => {
    const loading = render({ ready: false });
    const underMenu = render({}, false);
    await rest(3000);
    expect(labelOpacity(loading)).toBe(0);
    expect(labelOpacity(underMenu)).toBe(0);
    expect(stored.has(HINT_KEY)).toBe(false);
  });

  it("ends at once on any touch, anywhere on the area, and stays spent", async () => {
    const tree = render();
    await rest(1300);
    expect(offset(tree)).toBe(-MESSAGES_PEEK);
    act(() => area(tree).onTouchStart());
    expect(offset(tree)).toBe(0);
    expect(labelOpacity(tree)).toBe(0);
    expect(record()).toMatchObject({ shown: 1 });
  });

  it("plays its one reminder three days on, only while a direct message is unread", async () => {
    const seen = {
      swiped: false,
      shown: 1,
      lastShownAt: Date.now() - MESSAGES_HINT_REPEAT_MS,
    };
    stored.set(HINT_KEY, JSON.stringify(seen));
    const quiet = render({ unreadConversations: 0 });
    await rest(1300);
    expect(labelOpacity(quiet)).toBe(0);
    const tree = render({ unreadConversations: 2 });
    await rest(1300);
    expect(labelOpacity(tree)).toBe(1);
    expect(record()).toMatchObject({ shown: 2 });
  });

  it("waits while a sheet is open over Chat home, and plays once it closes", async () => {
    // What's new opens on the launch the hint first could: a sheet leaves
    // the screen under it focused.
    let close!: () => void;
    act(() => {
      close = holdOverlay();
    });
    const tree = render();
    await rest(3000);
    expect(labelOpacity(tree)).toBe(0);
    expect(record()).toBeNull();
    act(() => close());
    await rest(1300);
    expect(labelOpacity(tree)).toBe(1);
    expect(record()).toMatchObject({ shown: 1 });
  });

  it("gives the showing back when a sheet covers it before it could be read", async () => {
    const tree = render();
    await rest(1300);
    expect(record()).toMatchObject({ shown: 1 });
    let close!: () => void;
    await act(async () => {
      close = holdOverlay();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(offset(tree)).toBe(0);
    expect(labelOpacity(tree)).toBe(0);
    expect(record()).toMatchObject({ shown: 0 });
    act(() => close());
    await rest(1300);
    expect(labelOpacity(tree)).toBe(1);
    expect(record()).toMatchObject({ shown: 1 });
  });

  it("keeps the showing spent when Chat home is left after it has been up long enough to read", async () => {
    const tree = render();
    await rest(1200 + 1000);
    expect(labelOpacity(tree)).toBe(1);
    await act(async () => {
      tree.update(element({ ready: false }, true));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(labelOpacity(tree)).toBe(0);
    expect(record()).toMatchObject({ shown: 1 });
  });

  it("does not play over a finger that is on the screen, and waits for it to rest", async () => {
    const tree = render();
    act(() => area(tree).onTouchStart());
    await rest(3000);
    expect(labelOpacity(tree)).toBe(0);
    expect(record()).toBeNull();
    act(() => area(tree).onTouchEnd());
    await rest(1100);
    expect(labelOpacity(tree)).toBe(0);
    await rest(200);
    expect(labelOpacity(tree)).toBe(1);
  });

  it("does not play a showing it could not record", async () => {
    vi.mocked(AsyncStorage.setItem).mockRejectedValue(new Error("disk full"));
    const tree = render();
    await rest(3000);
    expect(labelOpacity(tree)).toBe(0);
    expect(offset(tree)).toBe(0);
  });

  it("records the swipe when it opens Messages, so the hint is over for good", async () => {
    const tree = render();
    act(() => pan(tree).handlers.onBegin!({}));
    act(() => pan(tree).handlers.onStart!({}));
    await act(async () => {
      pan(tree).handlers.onEnd!({ translationX: -120, velocityX: 0 }, true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/messages");
    expect(JSON.parse(stored.get(HINT_KEY)!)).toMatchObject({ swiped: true });
  });

  it("records nothing for a slide that stops short", async () => {
    const tree = render({ ready: false });
    act(() => pan(tree).handlers.onStart!({}));
    await act(async () => {
      pan(tree).handlers.onEnd!({ translationX: -30, velocityX: 0 }, true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(stored.has(HINT_KEY)).toBe(false);
  });
});
