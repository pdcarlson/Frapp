/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { AccessibilityInfo } from "react-native";
import { withRepeat } from "react-native-reanimated";
import { describe, expect, it, vi } from "vitest";

// These screens paint with the chapter accent (`useChapterBranding`), which
// reads the current chapter through the client provider these specs don't
// mount. A purple chapter's values, deliberately not house gold, so a control
// that slips back to a `gold.*` token shows up in an assertion; the hook
// itself has its own spec.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
    textMark: null,
  }),
}));
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { expectRoundedRipple } from "@/test/pressable-row";
import { SkeletonBlock } from "@/components/state-block";
import {
  accessibilityLabelFor,
  badgeLabel,
  ChannelListSkeleton,
  ChannelRow,
  channelMarkFor,
  HIDE_ACTION,
  PIN_ACTION,
} from "./channel-row";

/**
 * The rules under test are the two `foundations.md:67-68` states this row
 * exists to distinguish: mention/DM red means "you were addressed" and is fixed
 * across every chapter, while a plain unread channel is neutral — never red,
 * never accent.
 *
 * `vitest.setup.ts` mocks `react-native` to string stand-ins, so these render
 * through `react-test-renderer` and read the `style` prop directly rather than
 * asserting on DOM output.
 */

function renderRow(props: Partial<React.ComponentProps<typeof ChannelRow>>) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ChannelRow
          name="general"
          unreadCount={0}
          mentionCount={0}
          onPress={vi.fn()}
          {...props}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/** Flattens the array-or-object `style` prop into one object. */
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

/** The badge is the only View carrying a `minWidth` in this row. */
function findBadgeStyle(
  tree: ReactTestRenderer,
): Record<string, unknown> | null {
  const match = tree.root
    .findAll(
      (node) =>
        // `vitest.setup.ts` mocks `View` to the string "View", but tsc reads
        // the real react-native types, where `node.type` narrows to the
        // intrinsic-element union — hence the widening cast.
        (node.type as unknown as string) === "View" &&
        "minWidth" in flatten(node.props.style),
      { deep: true },
    )
    .at(0);
  return match ? flatten(match.props.style) : null;
}

describe("badgeLabel", () => {
  it("shows the unread total when nothing mentions the viewer", () => {
    expect(badgeLabel(7, 0)).toBe("7");
  });

  it("shows the mention count, not the total, when addressed", () => {
    // The drawn row reads `@ 2` while its unread total is higher: the badge
    // answers "how many messages are about you", not "how many are new".
    expect(badgeLabel(9, 2)).toBe("@ 2");
  });

  it("caps at 99+ in both states", () => {
    expect(badgeLabel(150, 0)).toBe("99+");
    expect(badgeLabel(150, 120)).toBe("@ 99+");
  });
});

// `initialsFor` moved to `lib/chat/display-name.ts` (shared with the message
// bubble) and its cases moved with it — see `display-name.spec.ts`.

describe("accessibilityLabelFor", () => {
  it("prefixes a channel with # and a DM with nothing", () => {
    expect(
      accessibilityLabelFor({
        name: "general",
        isDirect: false,
        unreadCount: 0,
        mentionCount: 0,
      }),
    ).toBe("#general");
    expect(
      accessibilityLabelFor({
        name: "Marcus Reid",
        isDirect: true,
        unreadCount: 0,
        mentionCount: 0,
      }),
    ).toBe("Marcus Reid");
  });

  it("speaks mentions before the unread total", () => {
    // The colour difference is the whole signal for a sighted user, so it has
    // to survive into the spoken label rather than being conveyed by fill alone.
    expect(
      accessibilityLabelFor({
        name: "announcements",
        isDirect: false,
        unreadCount: 9,
        mentionCount: 2,
      }),
    ).toBe("#announcements, 2 mentions, 9 unread");
  });

  it("singularises one mention", () => {
    expect(
      accessibilityLabelFor({
        name: "general",
        isDirect: false,
        unreadCount: 1,
        mentionCount: 1,
      }),
    ).toBe("#general, 1 mention, 1 unread");
  });
});

describe("ChannelRow badge colour", () => {
  it("renders no badge on a read channel", () => {
    expect(findBadgeStyle(renderRow({}))).toBeNull();
  });

  it("draws no number for a channel that is merely unread", () => {
    // 2026-11-07: only what addresses the member carries a count; the bold
    // name says the channel is unread, as on Discord.
    expect(findBadgeStyle(renderRow({ unreadCount: 7 }))).toBeNull();
  });

  it("uses the fixed mention red when the viewer is addressed", () => {
    const style = findBadgeStyle(
      renderRow({ unreadCount: 9, mentionCount: 2 }),
    );

    expect(style?.backgroundColor).toBe(
      signetDarkTokens.color.semantic.mention,
    );
  });

  it("treats a mention with a zero unread total as an unread row", () => {
    // Defensive: a badge in mention red over a row styled as read would be a
    // visible contradiction if the two counts ever disagreed.
    const style = findBadgeStyle(
      renderRow({ unreadCount: 0, mentionCount: 1 }),
    );

    expect(style?.backgroundColor).toBe(
      signetDarkTokens.color.semantic.mention,
    );
  });
});

// #2303: a 1:1 DM row can be hidden. The long press is invisible to a screen
// reader, so the same action has to exist as a named accessibility action.
describe("ChannelRow hide affordance", () => {
  function pressable(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) => (node.type as unknown as string) === "Pressable",
      { deep: true },
    )[0]!;
  }

  it("offers nothing when the row cannot be hidden", () => {
    const row = pressable(renderRow({}));

    expect(row.props.onLongPress).toBeUndefined();
    expect(row.props.accessibilityActions).toBeUndefined();
  });

  it("hides on a long press, and on the named accessibility action", () => {
    const onHide = vi.fn();
    const row = pressable(renderRow({ isDirect: true, onHide }));

    expect(row.props.accessibilityActions).toEqual([
      { name: HIDE_ACTION, label: "Hide conversation" },
    ]);
    row.props.onLongPress();
    row.props.onAccessibilityAction({
      nativeEvent: { actionName: "activate" },
    });
    row.props.onAccessibilityAction({
      nativeEvent: { actionName: HIDE_ACTION },
    });
    expect(onHide).toHaveBeenCalledTimes(2);
  });
});

describe("ChannelRow pin and DM badge (#2877)", () => {
  function pressable(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) => (node.type as unknown as string) === "Pressable",
      { deep: true },
    )[0]!;
  }

  it("offers Pin to top, then Hide, as named accessibility actions", () => {
    const onTogglePin = vi.fn();
    const onHide = vi.fn();
    const row = pressable(renderRow({ isDirect: true, onHide, onTogglePin }));

    expect(row.props.accessibilityActions).toEqual([
      { name: PIN_ACTION, label: "Pin to top" },
      { name: HIDE_ACTION, label: "Hide conversation" },
    ]);
    row.props.onAccessibilityAction({
      nativeEvent: { actionName: PIN_ACTION },
    });
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onHide).not.toHaveBeenCalled();
  });

  it("names the action Unpin from top on a pinned row", () => {
    const row = pressable(renderRow({ isPinned: true, onTogglePin: vi.fn() }));

    expect(row.props.accessibilityActions).toEqual([
      { name: PIN_ACTION, label: "Unpin from top" },
    ]);
  });

  // foundations.md §6 "Where the accent goes" (2026-11-05): a row icon is
  // neutral, so a pinned row's `#` stays muted like any other row's.
  it("keeps a pinned row's sigil neutral, never the chapter accent", () => {
    for (const isPinned of [true, false]) {
      const sigil = renderRow({ isPinned, onTogglePin: vi.fn() }).root.find(
        (node) =>
          (node.type as unknown) === "Text" && node.props.children === "#",
      );
      const flat = JSON.stringify(sigil.props.style);
      expect(flat).toContain(
        `"color":"${signetDarkTokens.color.text.muted}"`,
      );
      expect(flat).not.toContain("#CB9FFF");
    }
  });

  it("takes the long press from `onLongPress` when given", () => {
    const onLongPress = vi.fn();
    const onHide = vi.fn();
    const row = pressable(renderRow({ isDirect: true, onHide, onLongPress }));

    row.props.onLongPress();
    expect(onLongPress).toHaveBeenCalled();
    expect(onHide).not.toHaveBeenCalled();
  });

  it("draws an unread DM in mention red, like web", () => {
    const dmStyle = findBadgeStyle(
      renderRow({ isDirect: true, unreadCount: 1, mentionCount: 0 }),
    );
    const channelStyle = findBadgeStyle(
      renderRow({ isDirect: false, unreadCount: 1, mentionCount: 0 }),
    );

    expect(dmStyle?.backgroundColor).toBe(
      signetDarkTokens.color.semantic.mention,
    );
    expect(channelStyle).toBeNull();
  });
});

// Unread is a 700 title in foreground with a white pip; read is a 400 title in
// muted-foreground (owner, 2026-11-08). The row itself never takes a fill at rest;
// the surface lift is only the iOS press state, shared with every list row.
describe("ChannelRow unread emphasis and press feedback", () => {
  function pressable(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) => (node.type as unknown as string) === "Pressable",
      { deep: true },
    )[0]!;
  }

  function titleStyle(tree: ReactTestRenderer) {
    const title = tree.root.findAll(
      (node) =>
        (node.type as unknown as string) === "Text" &&
        node.props.children === "general",
      { deep: true },
    )[0]!;
    return flatten(title.props.style);
  }

  // Read is grey, unread is white and bold (owner, 2026-11-08), so the two
  // differ by colour and weight, not weight alone.
  it("draws an unread title bold and white, a read one regular and grey", () => {
    const unread = titleStyle(renderRow({ unreadCount: 7 }));
    const read = titleStyle(renderRow({}));

    expect(unread.fontFamily).toBe("Figtree_700Bold");
    expect(unread.color).toBe(signetDarkTokens.color.text.foreground);
    expect(read.fontFamily).toBe("Figtree_400Regular");
    expect(read.color).toBe(signetDarkTokens.color.text.mutedForeground);
  });

  it("draws the unread pip only on a row that reads as unread", () => {
    const pips = (tree: ReactTestRenderer) =>
      tree.root.findAll(
        (node) =>
          (node.type as unknown as string) === "View" &&
          node.props.testID === "channel-row-unread-pip",
      );
    expect(pips(renderRow({ unreadCount: 3 }))).toHaveLength(1);
    expect(pips(renderRow({}))).toHaveLength(0);
    // A muted channel's plain unread stays quiet; a mention gets past it.
    expect(pips(renderRow({ unreadCount: 3, isMuted: true }))).toHaveLength(0);
    expect(
      pips(renderRow({ unreadCount: 3, mentionCount: 1, isMuted: true })),
    ).toHaveLength(1);
  });

  it("draws a muted unread row's title quiet, with the crossed-out bell", () => {
    const tree = renderRow({ unreadCount: 7, isMuted: true });
    const title = titleStyle(tree);
    expect(title.fontFamily).toBe("Figtree_400Regular");
    expect(title.color).toBe(signetDarkTokens.color.text.muted);
    expect(
      tree.root.findAll((node) => (node.type as unknown) === "Svg"),
    ).toHaveLength(1);
    expect(
      renderRow({ unreadCount: 7 }).root.findAll(
        (node) => (node.type as unknown) === "Svg",
      ),
    ).toHaveLength(0);
  });

  it("lets a mention past a mute, as push does", () => {
    const title = titleStyle(
      renderRow({ unreadCount: 2, mentionCount: 1, isMuted: true }),
    );
    expect(title.fontFamily).toBe("Figtree_700Bold");
    expect(title.color).toBe(signetDarkTokens.color.text.foreground);
  });

  it("gives an unread row no fill at rest", () => {
    const row = pressable(renderRow({ unreadCount: 7, mentionCount: 1 }));

    expect(flatten(row.props.style({ pressed: false }))).not.toHaveProperty(
      "backgroundColor",
    );
  });

  it("ripples on Android and lifts on iOS while held, never fading", () => {
    const row = pressable(renderRow({ unreadCount: 7 }));
    const held = flatten(row.props.style({ pressed: true }));

    expect(row.props.android_ripple?.color).toMatch(/^rgba\(/);
    // The suite's react-native stub runs as iOS. A row on the page lifts one
    // step above it (`lib/surfaces.ts`).
    expect(held.backgroundColor).toBe(signetDarkTokens.color.surface.surface1);
    expect(held).not.toHaveProperty("opacity");
  });

  // The row pads itself by `sm` and bleeds that same `sm` into the screen
  // gutter, so the sigil lines up with the section captions and the press
  // lift still clears the text. Dropping either half breaks one of the two.
  // The bleed sits on the clip that rounds the ripple (`PressableRow`), so the
  // row is where it was before the clip wrapped it.
  it("bleeds its own padding into the screen gutter, inside a rounded clip", () => {
    const row = pressable(renderRow({}));
    const { clip, resting } = expectRoundedRipple(
      row,
      signetDarkTokens.radius.control,
    );

    expect(resting.paddingHorizontal).toBe(signetDarkTokens.spacing.sm);
    expect(clip.marginHorizontal).toBe(-signetDarkTokens.spacing.sm);
    expect(resting).not.toHaveProperty("marginHorizontal");
  });
});

describe("ChannelListSkeleton", () => {
  it("draws channel-shaped rows on the row's own geometry, with no spinner", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <ChannelListSkeleton rows={4} />
        </FrappThemeProvider>,
      );
    });
    const list = tree.root.find(
      (node) => node.props.accessibilityRole === "progressbar",
    );
    expect(list.props.accessibilityLabel).toBe("Loading channels");
    // Without `accessible`, VoiceOver skips a View with no text in it, so
    // Chat home would sound blank while it loads.
    expect(list.props.accessible).toBe(true);

    // A skeleton row is a one-line `ChannelRow` row: same height, same
    // direction.
    const rows = tree.root.findAll(
      (node) =>
        (node.type as unknown as string) === "View" &&
        flatten(node.props.style).flexDirection === "row" &&
        flatten(node.props.style).paddingVertical === 0 &&
        flatten(node.props.style).minHeight === signetDarkTokens.touch.minimum,
    );
    expect(rows).toHaveLength(4);
    expect(
      tree.root.findAll(
        (node) => (node.type as unknown as string) === "ActivityIndicator",
      ),
    ).toHaveLength(0);
  });

  // Eleven blocks for five rows, and one pulse for all of them: one Reduce
  // Motion subscription and one animation, not one per block.
  it("pulses every block from one shared pulse", () => {
    const listeners = vi.mocked(AccessibilityInfo.addEventListener);
    listeners.mockClear();
    vi.mocked(withRepeat).mockClear();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <ChannelListSkeleton rows={5} />
        </FrappThemeProvider>,
      );
    });
    // The caption, then a sigil and a title per row.
    expect(tree.root.findAllByType(SkeletonBlock)).toHaveLength(11);
    expect(
      listeners.mock.calls.filter(
        ([event]) => (event as string) === "reduceMotionChanged",
      ),
    ).toHaveLength(1);
    expect(vi.mocked(withRepeat)).toHaveBeenCalledTimes(1);
  });
});

describe("accessibilityLabelFor, muted and previewed rows", () => {
  it("says muted after the name and reads the preview last", () => {
    expect(
      accessibilityLabelFor({
        name: "social",
        isDirect: false,
        unreadCount: 3,
        mentionCount: 0,
        isMuted: true,
        preview: "Jake: see you at 6",
      }),
    ).toBe("#social, muted, 3 unread, Jake: see you at 6");
  });

  it("reads nothing for a held, blank preview line", () => {
    expect(
      accessibilityLabelFor({
        name: "social",
        isDirect: false,
        unreadCount: 0,
        mentionCount: 0,
        preview: "",
      }),
    ).toBe("#social");
  });
});

describe("ChannelRow mark (#4134)", () => {
  const hashes = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "#",
    );
  const marked = (tree: ReactTestRenderer, mark: string) =>
    tree.root.findAll((node) => node.props.testID === `channel-row-${mark}`);

  it("picks the lock for PRIVATE and ROLE_GATED, the shield for the audit channel, # for the rest", () => {
    expect(channelMarkFor({ type: "PUBLIC", name: "general" })).toBe("hash");
    expect(channelMarkFor({ type: "PRIVATE", name: "exec" })).toBe("lock");
    expect(channelMarkFor({ type: "ROLE_GATED", name: "officers" })).toBe(
      "lock",
    );
    expect(channelMarkFor({ type: "PRIVATE", name: "chapter-audit" })).toBe(
      "audit",
    );
  });

  it("draws a lock, not #, on a PRIVATE row", () => {
    const tree = renderRow({
      name: "exec",
      mark: channelMarkFor({ type: "PRIVATE", name: "exec" }),
    });
    expect(marked(tree, "lock")).toHaveLength(1);
    expect(hashes(tree)).toHaveLength(0);
  });

  it("draws # and no lock on a PUBLIC row", () => {
    const tree = renderRow({
      mark: channelMarkFor({ type: "PUBLIC", name: "general" }),
    });
    expect(hashes(tree)).toHaveLength(1);
    expect(marked(tree, "lock")).toHaveLength(0);
  });

  it("paints the lock in the sigil's read, unread and muted colours", () => {
    const strokeOf = (props: Partial<React.ComponentProps<typeof ChannelRow>>) =>
      renderRow({ name: "exec", mark: "lock", ...props })
        .root.findAll((node) => (node.type as unknown) === "Path")
        .map((node) => node.props.stroke)[0];
    expect(strokeOf({})).toBe(signetDarkTokens.color.text.muted);
    expect(strokeOf({ unreadCount: 3 })).toBe(
      signetDarkTokens.color.text.foreground,
    );
    expect(strokeOf({ isMuted: true })).toBe(
      signetDarkTokens.color.text.disabled,
    );
  });

  it("says a locked row is a private channel", () => {
    expect(
      renderRow({ name: "exec", mark: "lock", unreadCount: 2 }).root.findByProps(
        { accessibilityRole: "button" },
      ).props.accessibilityLabel,
    ).toBe("#exec, private channel, 2 unread");
    expect(
      renderRow({ name: "general" }).root.findByProps({
        accessibilityRole: "button",
      }).props.accessibilityLabel,
    ).toBe("#general");
  });
});
