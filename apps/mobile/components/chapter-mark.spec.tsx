/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { Image, Text } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * Chat home's title row draws the chapter mark (#2876, #2485). What it reads is
 * `useChapterBranding`'s `logoUrl` and `textMark`, whose precedence
 * `lib/chapter-branding.spec.tsx` and `@repo/validation`'s
 * `chapter-mark.spec.ts` pin; this pins what the mark does with them. The
 * chapter name beside it is `ScreenShell`'s title, not this component's.
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

import { ChapterMark } from "./chapter-mark";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ChapterMark />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll((node) => String(node.type) === String(Text))
    .map((node) => String(node.props.children));
}

describe("ChapterMark", () => {
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
  });

  it("falls back to the text mark when the logo fails to load", () => {
    branding.current.logoUrl = "https://storage.example/replaced.png";
    branding.current.textMark = "FIJI";
    const tree = render();
    act(() => {
      tree.root.findByType(Image).props.onError();
    });
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(
      tree.root.findByProps({ testID: "chapter-mark-text" }).findByType(Text)
        .props.children,
    ).toBe("FIJI");
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

  it("draws nothing for a chapter with no mark, never initials", () => {
    // The opted-out chapter with no short name: `textMark` is null. The name
    // then stands alone as the title row's text.
    const tree = render();
    expect(tree.toJSON()).toBeNull();
    expect(texts(tree)).toEqual([]);
  });
});
