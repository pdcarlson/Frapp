// @vitest-environment jsdom
import React, { act } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBottomSheetInternal } from "@gorhom/bottom-sheet";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import {
  pageSurfaces,
  type RaisedSurfaces,
  sheetSurfaces,
  useRaisedSurfaces,
} from "@/lib/surfaces";

const { surface } = signetDarkTokens.color;

/** WCAG relative luminance of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function read(): RaisedSurfaces {
  let captured!: RaisedSurfaces;
  function Probe() {
    captured = useRaisedSurfaces();
    return null;
  }
  act(() => {
    create(
      <FrappThemeProvider>
        <Probe />
      </FrappThemeProvider>,
    );
  });
  return captured;
}

afterEach(() => {
  vi.mocked(useBottomSheetInternal).mockReturnValue(null);
});

describe("pageSurfaces", () => {
  // The owner's read of a card two steps above the page, on 2026-11-12:
  // "almost too much contrast" (#4682).
  it("puts a card one ladder step above the page, not two", () => {
    const page = pageSurfaces(signetDarkTokens);
    expect(page.card).toBe(surface.surface1);
    expect(page.card).not.toBe(surface.card);
  });

  it("keeps what sits inside a card a visible step above it", () => {
    const page = pageSurfaces(signetDarkTokens);
    expect(page.raised).toBe(surface.card);
    // foundations.md §2's floor for two surfaces that must be told apart.
    expect(contrast(page.card, surface.background)).toBeGreaterThanOrEqual(
      1.15,
    );
    expect(contrast(page.raised, page.card)).toBeGreaterThanOrEqual(1.15);
  });
});

describe("sheetSurfaces", () => {
  it("leaves a sheet's cards where they were, one step under the sheet's own fill", () => {
    const sheet = sheetSurfaces(signetDarkTokens);
    expect(sheet.card).toBe(surface.card);
    expect(sheet.raised).toBe(surface.popover);
  });
});

describe("useRaisedSurfaces", () => {
  it("gives a screen's steps outside a sheet", () => {
    expect(read()).toEqual(pageSurfaces(signetDarkTokens));
  });

  it("gives a sheet's steps to anything drawn inside one", () => {
    vi.mocked(useBottomSheetInternal).mockReturnValue({} as never);
    expect(read()).toEqual(sheetSurfaces(signetDarkTokens));
  });
});
