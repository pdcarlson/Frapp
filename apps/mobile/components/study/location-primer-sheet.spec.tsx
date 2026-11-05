/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import appJson from "../../app.json";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    logoUrl: null,
    chapterName: null,
  }),
}));

/** `Linking` isn't in the suite's `react-native` stub; this spec adds it. */
const { openSettings } = vi.hoisted(() => ({
  openSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("react-native", async () => {
  const { reactNativeStub } = await import("@/test/react-native-stub");
  return { ...reactNativeStub, Linking: { openSettings } };
});

import { Platform } from "react-native";
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

  describe("when the OS will not ask again", () => {
    const platform = Platform as { OS: string; Version?: string | number };
    const { OS: os, Version: version } = platform;
    afterEach(() => {
      platform.OS = os;
      platform.Version = version;
    });

    const blocked = () =>
      texts(
        render(
          <LocationPrimerSheet
            canAskAgain={false}
            onAllow={() => {}}
            onDismiss={() => {}}
          />,
        ),
      ).join("");

    it("spells out the iOS path on iPhone, naming the app, and no OS", () => {
      platform.OS = "ios";
      platform.Version = "18.2";
      const copy = blocked();
      expect(copy).toContain(`Location is turned off for ${APP_NAME}`);
      expect(copy).toContain(`Settings → Apps → ${APP_NAME} → Location`);
      expect(copy).not.toContain("Permissions");
      // The old line said "iOS won't ask again", which reads as nonsense on
      // the other OS and narrates nothing the member can act on.
      expect(copy).not.toMatch(/\b(iOS|Android)\b/);
    });

    it("skips the Apps row before iOS 18, which has none", () => {
      platform.OS = "ios";
      platform.Version = "17.6";
      expect(blocked()).toContain(
        `Turn it on in Settings → ${APP_NAME} → Location, then`,
      );
    });

    it("spells out Android's own path on Android", () => {
      // The iOS path was all this said, and Android has no such screen.
      platform.OS = "android";
      const copy = blocked();
      expect(copy).toContain(
        `Settings → Apps → ${APP_NAME} → Permissions → Location`,
      );
    });
  });

  it("opens Settings from the blocked branch, closing the sheet first", async () => {
    const onDismiss = vi.fn();
    const tree = render(
      <LocationPrimerSheet
        canAskAgain={false}
        onAllow={() => {}}
        onDismiss={onDismiss}
      />,
    );
    const button = tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        node
          .findAllByType("Text" as never)
          .some((text) => text.props.children === "Open Settings"),
    );

    await act(async () => {
      button.props.onPress();
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("offers Continue, not Open Settings, while the OS can still ask", () => {
    const rendered = texts(
      render(
        <LocationPrimerSheet
          canAskAgain
          onAllow={() => {}}
          onDismiss={() => {}}
        />,
      ),
    );
    expect(rendered).toContain("Continue");
    expect(rendered).not.toContain("Open Settings");
  });
});
