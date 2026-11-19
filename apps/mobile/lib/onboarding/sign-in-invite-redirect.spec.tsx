/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { INVITE_PASTE_COPY } from "@repo/validation";
import {
  peekRememberedInviteToken,
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

/** The pressable whose own text is `label`. */
function pressable(tree: ReactTestRenderer, label: string) {
  return tree.root
    .findAll((node) => (node.type as unknown) === "Pressable")
    .find((node) =>
      node
        .findAll((child) => (child.type as unknown) === "Text")
        .some((text) => text.props.children === label),
    );
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll((node) => (node.type as unknown) === "Text")
    .map((node) => node.props.children as unknown)
    .filter((child): child is string => typeof child === "string");
}

async function paste(tree: ReactTestRenderer, text: string): Promise<void> {
  vi.mocked(Clipboard.getStringAsync).mockResolvedValueOnce(text);
  await act(async () => {
    pressable(tree, "Paste")?.props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * #5626. The first screen a freshly installed app opens to offers Paste for
 * the invite web `/join` copied when the member tapped Get Frapp: one tap
 * and the invite card is open, before any account.
 */
describe("sign-in's Joining a chapter? strip (#5626)", () => {
  const INVITE_ID = "6f1c2a9e-3b4d-4c8e-9a7b-1d2e3f4a5b6c";

  it("asks above the ways in, and reads nothing before the tap", () => {
    const tree = render();
    const all = texts(tree);
    expect(all).toContain(INVITE_PASTE_COPY.title);
    expect(all).toContain(INVITE_PASTE_COPY.lede);
    expect(all.indexOf(INVITE_PASTE_COPY.title)).toBeLessThan(
      all.indexOf("Continue with email"),
    );
    expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
  });

  it("remembers a pasted invite and opens its card", async () => {
    const tree = render();
    await paste(tree, `https://app.frapp.live/join?token=${INVITE_ID}`);
    expect(peekRememberedInviteToken()).toBe(INVITE_ID);
    expect(redirectTarget(tree)).toBe("/(auth)/join");
  });

  it("says what was wrong in place of its line, and stays", async () => {
    const tree = render();
    await paste(tree, "1Z999AA10123456784");
    expect(redirectTarget(tree)).toBeNull();
    expect(peekRememberedInviteToken()).toBeNull();
    const all = texts(tree);
    expect(all).toContain(INVITE_PASTE_COPY.notInvite);
    expect(all).not.toContain(INVITE_PASTE_COPY.lede);
  });
});
