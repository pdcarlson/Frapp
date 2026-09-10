/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentFallbackApplied: false,
    logoUrl: null,
    chapterName: null,
  }),
}));

import { LocationPrimerSheet } from "./location-primer-sheet";

/**
 * Pins the product name on the study-zone primer. iOS Settings lists
 * `expo.name` (Signet), so the recovery path must keep `Settings → Signet`.
 */

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType("Text" as unknown as React.ComponentType)
    .flatMap((node) =>
      React.Children.toArray(node.props.children).filter(
        (child): child is string => typeof child === "string",
      ),
    );
}

describe("LocationPrimerSheet", () => {
  it("names Signet for the zone check, not Frapp", () => {
    const rendered = texts(
      render(
        <LocationPrimerSheet
          canAskAgain
          onAllow={() => {}}
          onDismiss={() => {}}
        />,
      ),
    );
    expect(
      rendered.some((line) => line.includes("Signet confirms you're in the study zone")),
    ).toBe(true);
    expect(rendered.some((line) => line.includes("while Signet is open"))).toBe(
      true,
    );
    expect(rendered.some((line) => /\bFrapp\b/.test(line))).toBe(false);
  });

  it("keeps Settings → Signet when iOS will not ask again", () => {
    const rendered = texts(
      render(
        <LocationPrimerSheet
          canAskAgain={false}
          onAllow={() => {}}
          onDismiss={() => {}}
        />,
      ),
    );
    expect(
      rendered.some((line) => line.includes("Location is turned off for Signet")),
    ).toBe(true);
    expect(
      rendered.some((line) => line.includes("Settings → Signet → Location")),
    ).toBe(true);
  });
});
