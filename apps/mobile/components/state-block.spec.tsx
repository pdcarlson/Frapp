/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { Text } from "react-native";
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
  EmptyState,
  EmptyStateAction,
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

describe("EmptyState", () => {
  it("stays on neutral chrome — empty is not a fault", () => {
    const tree = render(<EmptyState title="Nothing yet" body="Add one." />);
    const style = cardStyle(tree);

    expect(style.borderColor).toBe(signetDarkTokens.color.border.hairline);
    expect(String(style.borderColor)).not.toContain("248, 81, 73");
  });

  it("renders its copy and an optional action", () => {
    const tree = render(
      <EmptyState
        title="No documents"
        body="Nothing has been uploaded yet."
        action={<Text>Upload</Text>}
      />,
    );
    expect(texts(tree)).toEqual(
      expect.arrayContaining([
        "No documents",
        "Nothing has been uploaded yet.",
        "Upload",
      ]),
    );
  });

  // writing.md gives some empty states no title (Chat home's filtered-to-
  // nothing state). The card then draws tile glyph, body and action, with no
  // empty title line holding a gap open between them.
  it("draws no title line when given no title", () => {
    const tree = render(
      <EmptyState
        glyph="⌕"
        body="No channels match."
        action={<Text>Show all</Text>}
      />,
    );
    expect(texts(tree)).toEqual(["⌕", "No channels match.", "Show all"]);
    // An empty `Text` would still take a slot in the card's gap.
    expect(
      tree.root.findAllByType("Text" as unknown as React.ComponentType),
    ).toHaveLength(3);
  });
});

describe("the glyph tiles", () => {
  // The tile's character stands in for a drawn glyph, so a screen reader
  // skips it and starts at the words ("plus", "exclamation mark" otherwise).
  it("hides the empty and error tiles from screen readers", () => {
    for (const tree of [
      render(<EmptyState glyph="⌕" body="No channels match." />),
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
  // §10 gives empty and error the same anatomy, so the CTA and the retry share
  // one geometry and differ only in colour.
  it("draws the empty CTA and the error retry on one geometry", () => {
    const pressableStyle = (tree: ReactTestRenderer) => {
      const button = tree.root.find(
        (node) => (node.type as unknown) === "Pressable",
      );
      return flatten(button.props.style({ pressed: false }));
    };
    const geometry = (style: Record<string, unknown>) => ({
      marginTop: style.marginTop,
      minHeight: style.minHeight,
      justifyContent: style.justifyContent,
      borderRadius: style.borderRadius,
      borderWidth: style.borderWidth,
      paddingHorizontal: style.paddingHorizontal,
    });
    const cta = pressableStyle(
      render(<EmptyStateAction label="Show all" onPress={vi.fn()} />),
    );
    const retry = pressableStyle(
      render(
        <ErrorState title="Couldn't load" body="Gone." onRetry={vi.fn()} />,
      ),
    );

    expect(geometry(cta)).toEqual(geometry(retry));
    expect(geometry(retry)).toEqual({
      marginTop: signetDarkTokens.spacing.xs,
      minHeight: signetDarkTokens.touch.minimum,
      justifyContent: "center",
      borderRadius: signetDarkTokens.radius.control,
      borderWidth: 1,
      paddingHorizontal: signetDarkTokens.spacing.lg,
    });
    expect(cta.borderColor).not.toBe(retry.borderColor);
  });
});

describe("EmptyStateAction", () => {
  // §10's CTA is the Tinted button: the chapter accent's soft fill, border and
  // text, at the 44pt floor. A neutral outlined button there reads as the
  // error card's retry.
  it("draws the Tinted button at 44pt and calls back on press", () => {
    const onPress = vi.fn();
    const tree = render(<EmptyStateAction label="Show all" onPress={onPress} />);
    const button = tree.root.find(
      (node) => (node.type as unknown) === "Pressable",
    );
    const style = flatten(button.props.style({ pressed: false }));

    expect(style.minHeight).toBe(signetDarkTokens.touch.minimum);
    expect(style.backgroundColor).toBe("#3A2F14");
    expect(style.borderColor).toBe("#6E5523");
    const label = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" &&
        node.props.children === "Show all",
    );
    expect(flatten(label.props.style).color).toBe("#F4CB63");
    act(() => button.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("NoChapterState", () => {
  // Not an edge case: a missing `active_chapter_id` claim (no membership yet,
  // or a hook-off incident) leaves every chapter-scoped query disabled, and
  // this is what that member actually sees.
  it("names the missing chapter and points at the picker", () => {
    const tree = render(<NoChapterState noun="the directory" />);
    const copy = texts(tree).join(" ");

    expect(copy).toContain("No chapter selected");
    expect(copy).toContain("More → Switch chapter");
    expect(copy).toContain("the directory");
  });
});

describe("SkeletonLines", () => {
  it("draws content-shaped blocks rather than a spinner", () => {
    const tree = render(<SkeletonLines lines={3} />);
    const blocks = tree.root
      .findAllByType("View" as unknown as React.ComponentType)
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
        block.findByType("View" as unknown as React.ComponentType).props.style,
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
});
