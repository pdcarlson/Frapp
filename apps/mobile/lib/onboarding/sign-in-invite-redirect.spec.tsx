/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useLocalSearchParams } from "expo-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import {
  rememberInviteToken,
  resetRememberedInviteForTests,
} from "@/lib/onboarding/invite-token";

/**
 * #5625. A phone that remembers an invite opens the invite card, not bare
 * sign-in, so a relaunch signed out comes back to the chapter it was joining.
 * "Have a password? Sign in" on that card asks for this screen itself
 * (`password=1`), and gets it.
 *
 * Here rather than beside the screen: a spec under `app/` ships in the bundle
 * (`lib/routes.spec.ts`).
 */

const session = vi.hoisted(() => ({ status: "unauthenticated" as string }));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: session.status,
    isConfigured: true,
    callbackError: null,
    sendMagicLink: vi.fn(),
    signInWithOAuthProvider: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#CB9FFF" }),
}));

import SignIn from "@/app/(auth)/sign-in";

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

function redirectTarget(tree: ReactTestRenderer): string | null {
  const found = tree.root.findAll(
    (node) => (node.type as unknown) === "Redirect",
  );
  return found.length > 0 ? (found[0]!.props.href as string) : null;
}

beforeEach(() => {
  session.status = "unauthenticated";
  resetRememberedInviteForTests();
  vi.mocked(useLocalSearchParams).mockReturnValue({});
});

afterEach(() => {
  resetRememberedInviteForTests();
  vi.mocked(useLocalSearchParams).mockReturnValue({});
});

describe("sign-in with a remembered invite (#5625)", () => {
  it("opens the invite card instead", () => {
    act(() => rememberInviteToken("tok-1"));
    expect(redirectTarget(render())).toBe("/(auth)/join");
  });

  it("stays put when the card asked for the password screen", () => {
    act(() => rememberInviteToken("tok-1"));
    vi.mocked(useLocalSearchParams).mockReturnValue({ password: "1" });
    expect(redirectTarget(render())).toBeNull();
  });

  it("stays put with no invite remembered", () => {
    expect(redirectTarget(render())).toBeNull();
  });
});
