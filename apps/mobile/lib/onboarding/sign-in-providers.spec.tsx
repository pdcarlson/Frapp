/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { Platform } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { signInProviderLayout } from "@/lib/auth-providers";

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
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: "unauthenticated",
    isConfigured: true,
    callbackError: null,
    sendMagicLink: vi.fn(),
    signInWithOAuthProvider: auth.signInWithOAuthProvider,
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  }),
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
});
