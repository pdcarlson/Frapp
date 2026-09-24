/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  Text,
} from "react-native";
import * as Linking from "expo-linking";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import type { ClientPolicy } from "@/lib/client-policy";

const policy = vi.hoisted(() => ({
  current: { updateRequired: false, updateUrl: null } as ClientPolicy,
}));
vi.mock("@/lib/client-policy", () => ({
  useClientPolicy: () => policy.current,
}));

import { ClientPolicyGate, UPDATE_REQUIRED_COPY } from "./client-policy-gate";

function render(): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <FrappThemeProvider>
        <ClientPolicyGate>
          <Text testID="app">the app</Text>
        </ClientPolicyGate>
      </FrappThemeProvider>,
    );
  });
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((node) => [node.props.children].flat().join(""));
}

/** The View wrapping the app, found through the app's own Text. */
function appWrapper(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ testID: "app" }).parent!;
}

describe("ClientPolicyGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policy.current = { updateRequired: false, updateUrl: null };
  });

  it("renders the app untouched while the build is supported", () => {
    const renderer = render();
    expect(texts(renderer)).toEqual(["the app"]);
    expect(appWrapper(renderer).props.pointerEvents).toBe("auto");
    expect(appWrapper(renderer).props.accessibilityElementsHidden).toBe(false);
    expect(BackHandler.addEventListener).not.toHaveBeenCalled();
  });

  it("covers the app, and takes it out of touch and screen readers, below the minimum", () => {
    policy.current = { updateRequired: true, updateUrl: "https://a.test/app" };
    const renderer = render();

    expect(texts(renderer)).toEqual([
      "the app",
      UPDATE_REQUIRED_COPY.title,
      UPDATE_REQUIRED_COPY.body,
      UPDATE_REQUIRED_COPY.cta,
    ]);
    const wrapper = appWrapper(renderer);
    expect(wrapper.props.pointerEvents).toBe("none");
    expect(wrapper.props.accessibilityElementsHidden).toBe(true);
    expect(wrapper.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(Keyboard.dismiss).toHaveBeenCalled();
  });

  it("holds Android's back button so the hidden navigator can't pop", () => {
    policy.current = { updateRequired: true, updateUrl: "https://a.test/app" };
    render();
    const [event, handler] = vi.mocked(BackHandler.addEventListener).mock
      .calls[0] as unknown as [string, () => boolean];
    expect(event).toBe("hardwareBackPress");
    expect(handler()).toBe(true);
  });

  it("opens the update link with the OS", async () => {
    policy.current = { updateRequired: true, updateUrl: "https://a.test/app" };
    const renderer = render();
    await act(async () => {
      renderer.root.findByType(Pressable).props.onPress();
    });
    expect(Linking.openURL).toHaveBeenCalledWith("https://a.test/app");
    expect(texts(renderer)).not.toContain(UPDATE_REQUIRED_COPY.linkFailed);
  });

  it("says what to do when the link won't open", async () => {
    policy.current = { updateRequired: true, updateUrl: "https://a.test/app" };
    vi.mocked(Linking.openURL).mockRejectedValueOnce(new Error("no handler"));
    const renderer = render();
    await act(async () => {
      renderer.root.findByType(Pressable).props.onPress();
    });
    expect(texts(renderer)).toContain(UPDATE_REQUIRED_COPY.linkFailed);
    // VoiceOver has no live regions, and focus stays on the button.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      UPDATE_REQUIRED_COPY.linkFailed,
    );
  });

  it("leaves the link failure to the live region on Android, so TalkBack says it once", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    policy.current = { updateRequired: true, updateUrl: "https://a.test/app" };
    vi.mocked(Linking.openURL).mockRejectedValueOnce(new Error("no handler"));
    const renderer = render();
    await act(async () => {
      renderer.root.findByType(Pressable).props.onPress();
    });
    expect(texts(renderer)).toContain(UPDATE_REQUIRED_COPY.linkFailed);
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalledWith(
      UPDATE_REQUIRED_COPY.linkFailed,
    );
  });

  it("still blocks, with instructions instead of a button, when there is no link", () => {
    policy.current = { updateRequired: true, updateUrl: null };
    const renderer = render();
    expect(renderer.root.findAllByType(Pressable)).toHaveLength(0);
    expect(texts(renderer)).toContain(UPDATE_REQUIRED_COPY.noLink);
  });
});
