/** @vitest-environment jsdom */
import { backArrowColor } from "@/test/back-row";
import React from "react";
import { act } from "react";
import { BackHandler, Platform } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider, tint } from "@/lib/theme";
import { flatStyle } from "@/test/flat-style";
import {
  OAUTH_MEMBERSHIP_HINT,
  signInProviderLayout,
} from "@/lib/auth-providers";

/**
 * Which sign-in providers s01 shows, and in what order, per platform (#3349).
 *
 * The owner's first Android test met "Continue with Apple" as the first
 * button on an Android phone. The phone's own account now leads, and off iOS
 * Apple sits behind "Other ways to sign in" rather than going away, so an
 * account first made with Apple on an iPhone can still sign in.
 *
 * Here rather than beside the screen: a spec under `app/` is a route module
 * and ships in the bundle (`lib/routes.spec.ts`).
 */

const auth = vi.hoisted(() => ({
  signInWithOAuthProvider: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: "unauthenticated",
    isConfigured: true,
    callbackError: null,
    sendMagicLink: vi.fn(),
    signInWithOAuthProvider: auth.signInWithOAuthProvider,
    signInWithPassword: auth.signInWithPassword,
    signOut: vi.fn(),
  }),
}));

// A purple stand-in for a chapter's accent, so a back row that lost `house`
// paints purple and fails, rather than crashing for want of a QueryClient.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#CB9FFF" }),
}));

import SignIn from "@/app/(auth)/sign-in";

type Node = ReactTestRenderer["root"];

/**
 * Host-string matching, as `lib/onboarding/join-screen.spec.tsx` explains;
 * the casts are because `tsc` cannot see the mocked hosts.
 */
function isHost(node: Node, name: string): boolean {
  return (node.type as unknown) === name;
}

function buttonLabels(root: Node): string[] {
  return root
    .findAll((node) => isHost(node, "Pressable"))
    .flatMap((pressable) =>
      pressable
        .findAll((node) => isHost(node, "Text"))
        .map((text) => text.props.children as unknown)
        .filter((child): child is string => typeof child === "string"),
    );
}

function pressableLabelled(root: Node, label: string): Node {
  const found = root
    .findAll((node) => isHost(node, "Pressable"))
    .find((pressable) =>
      pressable
        .findAll((node) => isHost(node, "Text"))
        .some((text) => text.props.children === label),
    );
  if (!found) throw new Error(`no pressable labelled ${label}`);
  return found;
}

/**
 * Buttons drawn in the light fill: the one the screen leads with. The others
 * are Secondary buttons on the card fill (components.md § Buttons).
 */
function filledLabels(root: Node): string[] {
  return root
    .findAll(
      (node) =>
        isHost(node, "Pressable") &&
        flatStyle(node.props.style).backgroundColor ===
          signetDarkTokens.color.text.foreground,
    )
    .flatMap((pressable) =>
      pressable
        .findAll((node) => isHost(node, "Text"))
        .map((text) => text.props.children as unknown)
        .filter((child): child is string => typeof child === "string"),
    );
}

function hasHint(root: Node): boolean {
  return (
    root.findAll(
      (node) =>
        isHost(node, "Text") && node.props.children === OAUTH_MEMBERSHIP_HINT,
    ).length > 0
  );
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SignIn />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const platform = Platform as { OS: string };
const originalOS = platform.OS;

beforeEach(() => {
  auth.signInWithOAuthProvider.mockReset();
  auth.signInWithOAuthProvider.mockResolvedValue(undefined);
  auth.signInWithPassword.mockReset();
  auth.signInWithPassword.mockResolvedValue(undefined);
});

afterEach(() => {
  platform.OS = originalOS;
});

describe("signInProviderLayout", () => {
  it("leads with Apple on iOS and keeps Google beside it", () => {
    expect(signInProviderLayout("ios")).toEqual({
      primary: "apple",
      secondary: "google",
      tucked: null,
    });
  });

  it.each(["android", "web"])(
    "leads with Google on %s and tucks Apple away",
    (os) => {
      expect(signInProviderLayout(os)).toEqual({
        primary: "google",
        secondary: null,
        tucked: "apple",
      });
    },
  );
});

describe("sign-in providers on Android", () => {
  beforeEach(() => {
    platform.OS = "android";
  });

  it("shows Google, then email, with Apple behind Other ways to sign in", () => {
    const tree = render();
    expect(buttonLabels(tree.root)).toEqual([
      "Continue with Google",
      "Continue with email",
      "Other ways to sign in",
    ]);
    expect(filledLabels(tree.root)).toEqual(["Continue with Google"]);
    // The Hide My Email hint is about Apple, so it waits for the Apple button.
    expect(hasHint(tree.root)).toBe(false);
  });

  it("reveals Apple, which still signs in, from Other ways to sign in", async () => {
    const tree = render();
    act(() => {
      pressableLabelled(tree.root, "Other ways to sign in").props.onPress();
    });
    expect(buttonLabels(tree.root)).toEqual([
      "Continue with Google",
      "Continue with email",
      "Continue with Apple",
    ]);

    await act(async () => {
      pressableLabelled(tree.root, "Continue with Apple").props.onPress();
    });
    expect(auth.signInWithOAuthProvider).toHaveBeenCalledWith("apple");
    expect(hasHint(tree.root)).toBe(true);
  });
});

describe("sign-in providers on iOS", () => {
  beforeEach(() => {
    platform.OS = "ios";
  });

  it("shows Apple, then Google, then email, with nothing tucked away", () => {
    const tree = render();
    expect(buttonLabels(tree.root)).toEqual([
      "Continue with Apple",
      "Continue with Google",
      "Continue with email",
    ]);
    expect(filledLabels(tree.root)).toEqual(["Continue with Apple"]);
    expect(hasHint(tree.root)).toBe(true);
  });

  it("presses the light button as the gold one presses, and not while it runs", async () => {
    const tree = render();
    const lead = () =>
      tree.root.find(
        (node) =>
          isHost(node, "Pressable") &&
          flatStyle(node.props.style).backgroundColor ===
            signetDarkTokens.color.text.foreground,
      );
    const held = () => flatStyle(lead().props.style, true);

    expect(held().opacity).toBe(0.85);
    expect(lead().props.android_ripple).toEqual({ color: expect.any(String) });

    // Never settles, so the sign-in stays in flight.
    auth.signInWithOAuthProvider.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      lead().props.onPress();
    });
    expect(lead().props.android_ripple).toBeUndefined();
    expect(held().opacity).toBe(0.55);
  });
});

describe("the email form", () => {
  it("opens from Continue with email and closes back to the providers", () => {
    const tree = render();
    act(() => {
      pressableLabelled(tree.root, "Continue with email").props.onPress();
    });
    expect(buttonLabels(tree.root)).toContain("Sign in");
    expect(buttonLabels(tree.root)).not.toContain("Continue with Google");

    const back = tree.root.find(
      (node) =>
        isHost(node, "Pressable") &&
        node.props.accessibilityLabel === "Back to sign-in options",
    );
    act(() => {
      back.props.onPress();
    });
    expect(buttonLabels(tree.root)).toContain("Continue with Google");
    expect(buttonLabels(tree.root)).not.toContain("Sign in");
  });

  it("draws its ‹ Back row in house gold: (auth) has no chapter accent", () => {
    const tree = render();
    act(() => {
      pressableLabelled(tree.root, "Continue with email").props.onPress();
    });
    const back = tree.root.find(
      (node) =>
        isHost(node, "Pressable") &&
        node.props.accessibilityLabel === "Back to sign-in options",
    );
    const text = back.find((node) => isHost(node, "Text"));
    expect(text.props.children).toBe("Back");
    expect(backArrowColor(back)).toBe(signetDarkTokens.color.gold.askText);
  });

  it("marks the chosen mode in house gold, as the flow's other selections are", () => {
    const tree = render();
    act(() => {
      pressableLabelled(tree.root, "Continue with email").props.onPress();
    });
    const gold = signetDarkTokens.color.gold;
    const look = (label: string) => {
      const chip = pressableLabelled(tree.root, label);
      const text = chip.find((node) => isHost(node, "Text"));
      return {
        fill: flatStyle(chip.props.style).backgroundColor,
        ink: flatStyle(text.props.style).color,
        selected: chip.props.accessibilityState?.selected,
      };
    };
    const chosen = {
      fill: tint(gold.house),
      ink: gold.askText,
      selected: true,
    };

    expect(look("Password")).toEqual(chosen);
    expect(look("Magic link")).toEqual(
      expect.objectContaining({ selected: false }),
    );
    expect(look("Magic link").ink).not.toBe(gold.askText);

    act(() => {
      pressableLabelled(tree.root, "Magic link").props.onPress();
    });
    expect(look("Magic link")).toEqual(chosen);
    expect(look("Password").fill).not.toBe(tint(gold.house));
  });
});

describe("Android back on the email form", () => {
  const addListener = BackHandler.addEventListener as unknown as {
    mock: { calls: [string, () => boolean][] };
    mockClear: () => void;
  };

  beforeEach(() => {
    addListener.mockClear();
  });

  function latestBackHandler(): () => boolean {
    const calls = addListener.mock.calls.filter(
      ([event]) => event === "hardwareBackPress",
    );
    const last = calls[calls.length - 1];
    if (!last) throw new Error("no hardwareBackPress listener");
    return last[1];
  }

  it("closes the form back to the providers instead of leaving the screen", () => {
    const tree = render();
    act(() => {
      pressableLabelled(tree.root, "Continue with email").props.onPress();
    });

    let handled = false;
    act(() => {
      handled = latestBackHandler()();
    });
    expect(handled).toBe(true);
    expect(buttonLabels(tree.root)).toContain("Continue with email");
    expect(buttonLabels(tree.root)).not.toContain("Sign in");
  });

  it("holds the form while a sign-in is in flight", () => {
    const tree = render();
    act(() => {
      pressableLabelled(tree.root, "Continue with email").props.onPress();
    });
    // Never settles, so the screen stays submitting.
    auth.signInWithPassword.mockReturnValue(new Promise(() => {}));
    const email = tree.root.find(
      (node) =>
        isHost(node, "TextInput") && node.props.textContentType === "username",
    );
    act(() => {
      email.props.onChangeText("brother@westfield.edu");
    });
    const password = tree.root.find(
      (node) =>
        isHost(node, "TextInput") && node.props.textContentType === "password",
    );
    act(() => {
      password.props.onChangeText("hunter22");
    });
    act(() => {
      pressableLabelled(tree.root, "Sign in").props.onPress();
    });

    const back = tree.root.find(
      (node) =>
        isHost(node, "Pressable") &&
        node.props.accessibilityLabel === "Back to sign-in options",
    );
    expect(back.props.disabled).toBe(true);
    act(() => {
      latestBackHandler()();
    });
    // Still the form: its button spins, named for what is running.
    const primary = tree.root.find(
      (node) =>
        isHost(node, "Pressable") &&
        node.props.accessibilityLabel === "Signing in…",
    );
    expect(primary.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(buttonLabels(tree.root)).not.toContain("Continue with email");
  });
});
