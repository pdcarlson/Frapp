/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #3346: which keyboard-avoiding view a screen gets, per platform and path.
 *
 * On the first Play build the keyboard covered the chat composer. The app-wide
 * `KeyboardProvider` stops Android's window from resizing for the keyboard,
 * and the thread had switched React Native's avoiding view off on Android
 * because it assumed the window would resize. These pin the three cases, so a
 * later edit can't send Android store builds back to an avoiding view that
 * does nothing.
 */

const env = vi.hoisted(() => ({ executionEnvironment: "bare" }));

vi.mock("expo-constants", () => ({
  default: {
    get executionEnvironment() {
      return env.executionEnvironment;
    },
  },
  ExecutionEnvironment: {
    Bare: "bare",
    Standalone: "standalone",
    StoreClient: "storeClient",
  },
}));

type KeyboardControllerModule =
  typeof import("react-native-keyboard-controller");

/** The library's view, as a host the renderer can find by name. */
const FAKE_MODULE = {
  KeyboardProvider: "KeyboardProvider",
  KeyboardAvoidingView: "LibraryKeyboardAvoidingView",
} as unknown as KeyboardControllerModule;

let originalOS: string;

beforeEach(async () => {
  vi.resetModules();
  const { Platform } = await import("react-native");
  originalOS = Platform.OS;
});

afterEach(async () => {
  const { Platform } = await import("react-native");
  (Platform as { OS: string }).OS = originalOS;
});

async function renderArea(
  os: string,
  path: "native" | "expo-go",
  iosInsetFromScrollView = false,
) {
  const { Platform } = await import("react-native");
  (Platform as { OS: string }).OS = os;
  env.executionEnvironment = path === "expo-go" ? "storeClient" : "bare";

  const keyboard = await import("./keyboard");
  const loader = vi.fn(() => FAKE_MODULE);
  keyboard.setKeyboardControllerLoaderForTests(loader);

  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <keyboard.KeyboardAvoidingArea
        style={{ flex: 1 }}
        collapsable={false}
        iosInsetFromScrollView={iosInsetFromScrollView}
      >
        <React.Fragment />
      </keyboard.KeyboardAvoidingArea>,
    );
  });
  return { tree, loader };
}

function only(tree: ReactTestRenderer, name: string) {
  return tree.root.findAll((node) => (node.type as unknown) === name);
}

describe("KeyboardAvoidingArea (#3346)", () => {
  it("uses the library's view with padding on an Android store build", async () => {
    const { tree } = await renderArea("android", "native");

    const [view] = only(tree, "LibraryKeyboardAvoidingView");
    expect(view).toBeDefined();
    expect(view.props.behavior).toBe("padding");
    expect(view.props.automaticOffset).toBe(true);
    // The screen's own props reach the view it renders.
    expect(view.props.collapsable).toBe(false);
    expect(view.props.style).toEqual({ flex: 1 });
    expect(only(tree, "KeyboardAvoidingView")).toHaveLength(0);
  });

  it("keeps React Native's padding view on iOS, without loading the library", async () => {
    const { tree, loader } = await renderArea("ios", "native");

    const [view] = only(tree, "KeyboardAvoidingView");
    expect(view.props.behavior).toBe("padding");
    expect(only(tree, "LibraryKeyboardAvoidingView")).toHaveLength(0);
    expect(loader).not.toHaveBeenCalled();
  });

  it("falls back to React Native's view, with no behaviour, on Android in Expo Go", async () => {
    const { tree, loader } = await renderArea("android", "expo-go");

    const [view] = only(tree, "KeyboardAvoidingView");
    expect(view.props.behavior).toBeUndefined();
    expect(only(tree, "LibraryKeyboardAvoidingView")).toHaveLength(0);
    expect(loader).not.toHaveBeenCalled();
  });

  // Sign-in's scroll view takes the keyboard inset itself on iOS
  // (`automaticallyAdjustKeyboardInsets`); padding around it would count the
  // keyboard twice. That prop does nothing on Android.
  it("is a plain view on iOS when the scroll view takes the inset itself", async () => {
    const { tree, loader } = await renderArea("ios", "native", true);

    expect(only(tree, "KeyboardAvoidingView")).toHaveLength(0);
    expect(only(tree, "LibraryKeyboardAvoidingView")).toHaveLength(0);
    const [view] = only(tree, "View");
    expect(view.props.style).toEqual({ flex: 1 });
    expect(loader).not.toHaveBeenCalled();
  });

  it("still pads on an Android store build when the scroll view takes the iOS inset", async () => {
    const { tree } = await renderArea("android", "native", true);

    const [view] = only(tree, "LibraryKeyboardAvoidingView");
    expect(view.props.behavior).toBe("padding");
    expect(view.props.iosInsetFromScrollView).toBeUndefined();
  });
});
