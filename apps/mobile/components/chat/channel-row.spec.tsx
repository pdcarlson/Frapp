/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { accessibilityLabelFor, badgeLabel, ChannelRow } from "./channel-row";

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

  it("uses the neutral fill for plain unread — never red, never accent", () => {
    const style = findBadgeStyle(renderRow({ unreadCount: 7 }));

    expect(style?.backgroundColor).toBe(signetDarkTokens.color.border.input);
    expect(style?.backgroundColor).not.toBe(
      signetDarkTokens.color.semantic.mention,
    );
  });

  it("uses the fixed mention red when the viewer is addressed", () => {
    const style = findBadgeStyle(
      renderRow({ unreadCount: 9, mentionCount: 2 }),
    );

    expect(style?.backgroundColor).toBe(
      signetDarkTokens.color.semantic.mention,
    );
  });

  it("keeps one badge geometry across both states", () => {
    // "fill and text are the only difference, so badge geometry stays one
    // recipe" — a regression here means the two states drifted apart.
    const neutral = findBadgeStyle(renderRow({ unreadCount: 7 }));
    const mention = findBadgeStyle(
      renderRow({ unreadCount: 7, mentionCount: 1 }),
    );

    expect(neutral?.minWidth).toBe(mention?.minWidth);
    expect(neutral?.height).toBe(mention?.height);
    expect(neutral?.borderRadius).toBe(mention?.borderRadius);
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
