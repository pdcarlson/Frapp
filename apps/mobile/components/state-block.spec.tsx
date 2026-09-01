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
    accentFallbackApplied: false,
    accentPrimary: "#F4CB63",
    accentOnPrimary: "#2B2009",
    logoUrl: null,
    chapterName: null,
  }),
}));

import {
  EmptyState,
  ErrorState,
  NoChapterState,
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
});

describe("NoChapterState", () => {
  // Not an edge case on this app: no token carries an `active_chapter_id` claim
  // in production (#805), so every chapter-scoped query stays disabled and this
  // is what a member actually sees.
  it("names the missing chapter and points at the picker", () => {
    const tree = render(<NoChapterState noun="the directory" />);
    const copy = texts(tree).join(" ");

    expect(copy).toContain("No chapter selected");
    expect(copy).toContain("More → Chapter");
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
  });
});
