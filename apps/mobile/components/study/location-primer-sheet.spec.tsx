/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import appJson from "../../app.json";

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
 * Pins the product name on the study-zone primer. iOS Settings lists the app
 * under `expo.name`, so the recovery path is read from `app.json` rather than
 * restated: renaming the binary without the copy fails here (ADR-25).
 */
const APP_NAME = appJson.expo.name;

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
  it("names the app for the zone check, never Signet", () => {
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
      rendered.some((line) =>
        line.includes(`${APP_NAME} confirms you're in the study zone`),
      ),
    ).toBe(true);
    expect(
      rendered.some((line) => line.includes(`while ${APP_NAME} is open`)),
    ).toBe(true);
    expect(rendered.some((line) => /\bSignet\b/.test(line))).toBe(false);
  });

  it("points at Settings → expo.name when iOS will not ask again", () => {
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
      rendered.some((line) =>
        line.includes(`Location is turned off for ${APP_NAME}`),
      ),
    ).toBe(true);
    expect(
      rendered.some((line) =>
        line.includes(`Settings → ${APP_NAME} → Location`),
      ),
    ).toBe(true);
  });
});
