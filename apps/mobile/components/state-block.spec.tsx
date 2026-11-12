/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { AccessibilityInfo } from "react-native";
import {
  cancelAnimation,
  useReducedMotion,
  withRepeat,
} from "react-native-reanimated";
import { NavigationContext } from "expo-router/react-navigation";
import { describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider, tint } from "@/lib/theme";

// The empty tile takes the chapter accent (components.md §10), and resolving it
// for real would drag `useCurrentChapter` — and therefore the API client and a
// QueryClient — into a spec about styling. The accent value itself is covered
// by `lib/chapter-branding.spec.tsx`.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentPrimary: "#F4CB63",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#3A2F14",
    accentBorder: "#6E5523",
    logoUrl: null,
    chapterName: null,
  }),
}));

import {
  ErrorState,
  NoChapterState,
  SkeletonBlock,
  SkeletonLines,
} from "./state-block";

/**
 * These pin the two rules §10 states that are easy to get wrong by copying the
 * nearest existing block: empty is accent-and-neutral only (a semantic hue
 * there reads as a fault when nothing is wrong), error carries the one
 * sanctioned semantic border and never the chapter accent.
 *
 * The 44pt retry assertion is the reason this component exists at all — the
 * inline copies these replace ship a retry button with no `minHeight`.
 */

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, entry) => ({ ...acc, ...flatten(entry) }),
      {},
    );
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}

/** The outermost View's resolved style — the card chrome. */
function cardStyle(tree: ReactTestRenderer): Record<string, unknown> {
  const [card] = tree.root.findAllByType("View" as unknown as React.ComponentType);
  return flatten(card.props.style);
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType("Text" as unknown as React.ComponentType)
    .flatMap((node) =>
      node.children.filter((child): child is string => typeof child === "string"),
    );
}

describe("ErrorState", () => {
  it("carries the semantic destructive border, and no accent", () => {
    const tree = render(<ErrorState title="Couldn't load" body="Try again." />);
    const style = cardStyle(tree);

    expect(style.borderColor).toBe(
      tint(signetDarkTokens.color.semantic.destructive, 0.28),
    );
    // §10: "Error surfaces MUST NOT use the chapter accent." The mocked accent
    // above is what a chapter would supply.
    expect(String(style.borderColor)).not.toContain("F4CB63");
  });

  it("gives the retry control a 44pt target", () => {
    const tree = render(
      <ErrorState title="Couldn't load" body="Try again." onRetry={vi.fn()} />,
    );
    const [button] = tree.root.findAllByType(
      "Pressable" as unknown as React.ComponentType,
    );
    const style = flatten(
      typeof button.props.style === "function"
        ? button.props.style({ pressed: false })
        : button.props.style,
    );

    expect(style.minHeight).toBe(signetDarkTokens.touch.minimum);
    expect(button.props.hitSlop).toBeGreaterThan(0);
  });

  it("renders no retry control when the caller offers no recovery", () => {
    const tree = render(<ErrorState title="Couldn't load" body="Gone." />);
    expect(
      tree.root.findAllByType("Pressable" as unknown as React.ComponentType),
    ).toHaveLength(0);
  });

  it("disables the retry control while a retry is in flight", () => {
    const tree = render(
      <ErrorState
        title="Couldn't load"
        body="Try again."
        onRetry={vi.fn()}
        isRetrying
      />,
    );
    const [button] = tree.root.findAllByType(
      "Pressable" as unknown as React.ComponentType,
    );

    expect(button.props.disabled).toBe(true);
    expect(texts(tree)).toContain("Retrying…");
  });
});

describe("the glyph tiles", () => {
  // The tile's character stands in for a drawn glyph, so a screen reader
  // skips it and starts at the words ("plus", "exclamation mark" otherwise).
  it("hides the empty and error tiles from screen readers", () => {
    for (const tree of [
      render(<ErrorState title="Couldn't load" body="Try again." />),
    ]) {
      const glyph = tree.root
        .findAllByType("Text" as unknown as React.ComponentType)
        .find((node) => ["⌕", "!"].includes(String(node.props.children)));
      const tile = glyph?.parent;
      expect(tile?.props.accessibilityElementsHidden).toBe(true);
      expect(tile?.props.importantForAccessibility).toBe(
        "no-hide-descendants",
      );
    }
  });
});

describe("the state buttons", () => {
  it("draws the error retry at the 44pt floor", () => {
    const tree = render(
      <ErrorState title="Couldn't load" body="Gone." onRetry={vi.fn()} />,
    );
    const button = tree.root.find(
      (node) => (node.type as unknown) === "Pressable",
    );
    const style = flatten(button.props.style({ pressed: false }));
    expect({
      marginTop: style.marginTop,
      minHeight: style.minHeight,
      justifyContent: style.justifyContent,
      borderRadius: style.borderRadius,
      borderWidth: style.borderWidth,
      paddingHorizontal: style.paddingHorizontal,
    }).toEqual({
      marginTop: signetDarkTokens.spacing.xs,
      minHeight: signetDarkTokens.touch.minimum,
      justifyContent: "center",
      borderRadius: signetDarkTokens.radius.control,
      borderWidth: 1,
      paddingHorizontal: signetDarkTokens.spacing.lg,
    });
  });
});

describe("NoChapterState", () => {
  it("says where to pick a chapter in one line", () => {
    const tree = render(<NoChapterState noun="the directory" />);
    expect(texts(tree).join("")).toBe(
      "Choose a chapter from You → Switch chapter to see the directory.",
    );
  });
});

describe("NoChapterState", () => {
  // Not an edge case: a missing `active_chapter_id` claim (no membership yet,
  // or a hook-off incident) leaves every chapter-scoped query disabled, and
  // this is what that member actually sees.
  it("names the missing chapter and points at the picker", () => {
    const tree = render(<NoChapterState noun="the directory" />);
    const copy = texts(tree).join(" ");

    expect(copy).toContain("You → Switch chapter");
    expect(copy).toContain("the directory");
  });
});

describe("SkeletonLines", () => {
  it("draws content-shaped blocks rather than a spinner", () => {
    const tree = render(<SkeletonLines lines={3} />);
    const blocks = tree.root
      .findAllByType("Animated.View" as unknown as React.ComponentType)
      .map((node) => flatten(node.props.style))
      .filter((style) => typeof style.width === "string");

    expect(blocks).toHaveLength(3);
    // §10: varied widths in the ~45–70% band, so the placeholder reads as text.
    expect(new Set(blocks.map((style) => style.width)).size).toBeGreaterThan(1);
    expect(
      tree.root.findAllByType(
        "ActivityIndicator" as unknown as React.ComponentType,
      ),
    ).toHaveLength(0);
  });

  it("exposes itself to assistive tech as busy, not as content", () => {
    const tree = render(<SkeletonLines />);
    const [card] = tree.root.findAllByType(
      "View" as unknown as React.ComponentType,
    );
    expect(card.props.accessibilityRole).toBe("progressbar");
    expect(card.props.accessibilityLabel).toBe("Loading");
    // Without `accessible`, VoiceOver skips a View with no text in it, so the
    // role and label are never read and the screen sounds blank.
    expect(card.props.accessible).toBe(true);
  });

  it("draws every shape as a SkeletonBlock, so the shimmer lands once", () => {
    const tree = render(<SkeletonLines lines={3} showTile />);
    const blocks = tree.root.findAllByType(SkeletonBlock);

    expect(blocks).toHaveLength(4);
    // What each block draws, not what it was passed: §10's control-sized tile
    // takes the control radius, text lines the chip radius (TODO-DESIGN: 6).
    const drawn = blocks.map((block) =>
      flatten(
        block.findByType("Animated.View" as unknown as React.ComponentType)
          .props.style,
      ),
    );
    expect(drawn[0]!.borderRadius).toBe(signetDarkTokens.radius.control);
    expect(drawn[0]!.width).toBe(signetDarkTokens.touch.minimum);
    for (const line of drawn.slice(1)) {
      expect(line.borderRadius).toBe(signetDarkTokens.radius.chip);
    }
  });

  // The card centres its contents (the empty and error stacks), but a
  // skeleton stands in for rows, which start at the left edge.
  it("left-aligns its blocks inside the centred card", () => {
    const tree = render(<SkeletonLines lines={2} showTile />);
    const [, stack] = tree.root.findAllByType(
      "View" as unknown as React.ComponentType,
    );
    const style = flatten(stack!.props.style);

    expect(style.alignItems).toBe("flex-start");
    expect(style.alignSelf).toBe("stretch");
  });

  // A skeleton takes the shape of what replaces it, so the screen doesn't
  // change when its content lands: every tone sits on `card`, and a grouped
  // list's skeleton takes the list's smaller corners.
  it("sits on the tone of what it turns into", () => {
    const { card } = signetDarkTokens.color.surface;
    const { radius } = signetDarkTokens;
    expect(cardStyle(render(<SkeletonLines />)).backgroundColor).toBe(card);
    const list = cardStyle(render(<SkeletonLines tone="list" />));
    expect(list.backgroundColor).toBe(card);
    expect(list.borderRadius).toBe(radius.card);
    expect(
      cardStyle(render(<ErrorState title="Failed" body="Retry." />))
        .backgroundColor,
    ).toBe(card);
  });
});

describe("SkeletonBlock's pulse", () => {
  const blockStyle = (tree: ReactTestRenderer) =>
    flatten(
      tree.root.findByType("Animated.View" as unknown as React.ComponentType)
        .props.style,
    );

  // The suite's Reanimated resolves an animation to its target at once, so a
  // running pulse reads as its low point. No screen around it, as in a
  // sheet (which renders above the navigators), so nothing pauses it.
  it("pulses between full and half opacity, for as long as it is up", () => {
    vi.mocked(withRepeat).mockClear();
    const tree = render(<SkeletonBlock width="60%" height={12} />);

    expect(blockStyle(tree).opacity).toBe(0.5);
    // Forever (-1), and back and forth rather than snapping to the top.
    expect(vi.mocked(withRepeat)).toHaveBeenCalledWith(0.5, -1, true);

    vi.mocked(cancelAnimation).mockClear();
    act(() => tree.unmount());
    expect(vi.mocked(cancelAnimation)).toHaveBeenCalledTimes(1);
  });

  it("holds still at full opacity under the system's reduced motion", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValueOnce(
      true,
    );
    vi.mocked(withRepeat).mockClear();
    try {
      const tree = render(<SkeletonBlock width="60%" height={12} />);

      expect(blockStyle(tree).opacity).toBe(1);
      expect(vi.mocked(withRepeat)).not.toHaveBeenCalled();
    } finally {
      vi.mocked(useReducedMotion).mockReturnValue(false);
    }
  });

  // Reanimated's `useReducedMotion` is the setting at launch. A member who
  // turns Reduce Motion on mid-session gets a still skeleton at once, and one
  // who turned it on before this block mounted gets one too.
  it("follows Reduce Motion as it changes, not as it was at launch", () => {
    const listeners = vi.mocked(AccessibilityInfo.addEventListener);
    listeners.mockClear();
    const tree = render(<SkeletonBlock width="60%" height={12} />);
    expect(blockStyle(tree).opacity).toBe(0.5);

    const [event, changed] = listeners.mock.calls.at(-1)! as unknown as [
      string,
      (enabled: boolean) => void,
    ];
    expect(event).toBe("reduceMotionChanged");

    vi.mocked(cancelAnimation).mockClear();
    act(() => changed(true));
    expect(blockStyle(tree).opacity).toBe(1);
    expect(vi.mocked(cancelAnimation)).toHaveBeenCalledTimes(1);

    act(() => changed(false));
    expect(blockStyle(tree).opacity).toBe(0.5);
  });

  it("reads the setting when it mounts", async () => {
    vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValueOnce(
      true,
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <FrappThemeProvider>
          <SkeletonBlock width="60%" height={12} />
        </FrappThemeProvider>,
      );
    });
    expect(blockStyle(tree).opacity).toBe(1);
  });

  /** A screen's navigation, as far as a block reads it: focus, blur, and now. */
  function screenNavigation() {
    let focused = true;
    const handlers: Record<string, Set<() => void>> = {
      focus: new Set(),
      blur: new Set(),
    };
    const navigation = {
      isFocused: () => focused,
      addListener: (event: "focus" | "blur", handler: () => void) => {
        handlers[event]!.add(handler);
        return () => handlers[event]!.delete(handler);
      },
    };
    const emit = (event: "focus" | "blur") => {
      focused = event === "focus";
      for (const handler of [...handlers[event]!]) handler();
    };
    return { navigation, handlers, emit };
  }

  // Tab screens stay mounted after the member leaves them, so a skeleton on
  // one kept animating with nobody watching.
  it("pauses while its screen is out of view, and picks up on return", () => {
    const { navigation, emit } = screenNavigation();
    const tree = render(
      <NavigationContext.Provider value={navigation as never}>
        <SkeletonBlock width="60%" height={12} />
      </NavigationContext.Provider>,
    );
    expect(blockStyle(tree).opacity).toBe(0.5);

    vi.mocked(cancelAnimation).mockClear();
    act(() => emit("blur"));
    expect(blockStyle(tree).opacity).toBe(1);
    expect(vi.mocked(cancelAnimation)).toHaveBeenCalledTimes(1);

    vi.mocked(withRepeat).mockClear();
    act(() => emit("focus"));
    expect(blockStyle(tree).opacity).toBe(0.5);
    expect(vi.mocked(withRepeat)).toHaveBeenCalledTimes(1);
  });

  // A skeleton is several blocks, and screens mount and unmount them all
  // session. A block that kept its listeners after unmounting would be called
  // on every tab change and Reduce Motion toggle from then on.
  it("lets go of its screen's focus and blur when it unmounts", () => {
    const { navigation, handlers } = screenNavigation();
    const tree = render(
      <NavigationContext.Provider value={navigation as never}>
        <SkeletonBlock width="60%" height={12} />
      </NavigationContext.Provider>,
    );
    expect(handlers.focus!.size).toBe(1);
    expect(handlers.blur!.size).toBe(1);

    act(() => tree.unmount());
    expect(handlers.focus!.size).toBe(0);
    expect(handlers.blur!.size).toBe(0);
  });

  it("stops listening for Reduce Motion when it unmounts", () => {
    const listeners = vi.mocked(AccessibilityInfo.addEventListener);
    listeners.mockClear();
    const tree = render(<SkeletonBlock width="60%" height={12} />);
    const index = listeners.mock.calls.findIndex(
      ([event]) => (event as string) === "reduceMotionChanged",
    );
    expect(index).toBeGreaterThanOrEqual(0);
    // The stub hands each listener a fresh subscription.
    const subscription = listeners.mock.results[index]!.value as {
      remove: () => void;
    };
    expect(vi.mocked(subscription.remove)).not.toHaveBeenCalled();

    act(() => tree.unmount());
    expect(vi.mocked(subscription.remove)).toHaveBeenCalledTimes(1);
  });

  // The first read is asked as the block mounts. A member who turns Reduce
  // Motion on before it answers has said something newer than the answer.
  it("keeps a change it heard over a first read that answers after it", async () => {
    let answer!: (enabled: boolean) => void;
    vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const listeners = vi.mocked(AccessibilityInfo.addEventListener);
    listeners.mockClear();
    const tree = render(<SkeletonBlock width="60%" height={12} />);
    const [, changed] = listeners.mock.calls.find(
      ([event]) => (event as string) === "reduceMotionChanged",
    )! as unknown as [string, (enabled: boolean) => void];

    act(() => changed(true));
    expect(blockStyle(tree).opacity).toBe(1);

    await act(async () => {
      answer(false);
    });
    expect(blockStyle(tree).opacity).toBe(1);
  });

  // A skeleton is many blocks. They share one pulse, so the work it costs is
  // one Reduce Motion subscription, one pair of focus and blur listeners and
  // one animation however many blocks it draws, and every block reads it.
  it("drives every block of a skeleton from one pulse", () => {
    const { navigation, handlers, emit } = screenNavigation();
    const listeners = vi.mocked(AccessibilityInfo.addEventListener);
    listeners.mockClear();
    vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockClear();
    vi.mocked(withRepeat).mockClear();
    const tree = render(
      <NavigationContext.Provider value={navigation as never}>
        <SkeletonLines lines={4} showTile />
      </NavigationContext.Provider>,
    );
    const opacities = () =>
      tree.root
        .findAllByType("Animated.View" as unknown as React.ComponentType)
        .map((node) => flatten(node.props.style).opacity);

    expect(opacities()).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(
      listeners.mock.calls.filter(
        ([event]) => (event as string) === "reduceMotionChanged",
      ),
    ).toHaveLength(1);
    expect(
      vi.mocked(AccessibilityInfo.isReduceMotionEnabled),
    ).toHaveBeenCalledTimes(1);
    expect(handlers.focus!.size).toBe(1);
    expect(handlers.blur!.size).toBe(1);
    expect(vi.mocked(withRepeat)).toHaveBeenCalledTimes(1);

    act(() => emit("blur"));
    expect(opacities()).toEqual([1, 1, 1, 1, 1]);
  });
});

