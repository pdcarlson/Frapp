/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { Image, Text } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * The mobile chat header draws the chapter mark (#2876). What it reads is
 * `useChapterBranding`'s `logoUrl` and `textMark`, whose precedence
 * `lib/chapter-branding.spec.tsx` and `@repo/validation`'s
 * `chapter-mark.spec.ts` pin; this pins what the header does with them.
 */
const branding = vi.hoisted(() => ({
  current: {
    accent: "#F4CB63",
    logoUrl: null as string | null,
    chapterName: "Tau Nu" as string | null,
    textMark: null as string | null,
  },
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => branding.current,
}));

import { ChapterHeaderTitle } from "./chapter-header-title";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ChapterHeaderTitle />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/** Every text node, the `Animated.Text` label included. */
function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll((node) => {
      // The setup stubs both as host strings ("Text", "Animated.Text").
      const type = String(node.type);
      return type === String(Text) || type === "Animated.Text";
    })
    .map((node) => String(node.props.children));
}

describe("ChapterHeaderTitle", () => {
  beforeEach(() => {
    branding.current = {
      accent: "#F4CB63",
      logoUrl: null,
      chapterName: "Tau Nu",
      textMark: null,
    };
  });

  it("draws the logo, not the text mark, when there is one", () => {
    branding.current.logoUrl = "https://storage.example/logo.png";
    branding.current.textMark = "FIJI";
    const tree = render();
    expect(tree.root.findAllByType(Image)).toHaveLength(1);
    expect(texts(tree)).not.toContain("FIJI");
    expect(texts(tree)).toContain("Tau Nu");
  });

  it("draws the text mark in an accent tile under the fixed on-house label", () => {
    branding.current.textMark = "FIJI";
    const tree = render();
    const tile = tree.root.findByProps({ testID: "chapter-mark-text" });
    expect(tile.findByType(Text).props.children).toBe("FIJI");
    expect(tile.props.style).toContainEqual({ backgroundColor: "#F4CB63" });
    const label = tile.findByType(Text).props.style;
    expect(label).toContainEqual(
      expect.objectContaining({ color: signetDarkTokens.color.gold.onHouse }),
    );
  });

  it("draws the name alone for a chapter with no mark, never initials", () => {
    // The opted-out chapter with no short name: `textMark` is null.
    const tree = render();
    expect(tree.root.findAllByProps({ testID: "chapter-mark-text" })).toHaveLength(
      0,
    );
    expect(texts(tree)).toEqual(["Tau Nu"]);
  });
});
