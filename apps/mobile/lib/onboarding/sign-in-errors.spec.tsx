/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UNCONFIRMED_EMAIL_COPY,
  WRONG_CREDENTIALS_COPY,
  cooldownCopy,
} from "@repo/hooks/auth-error-copy";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * What a brand-new tester reads when sign-in (s01) is refused (#3833).
 *
 * Every refusal is told in Frapp's words, never GoTrue's sentence ("Email not
 * confirmed", "Invalid login credentials", "For security purposes, you can
 * only request this after 44 seconds."). An address that was never confirmed
 * gets a way to send the email again, because the app has no sign-up of its
 * own to send it from.
 *
 * Here rather than beside the screen: a spec under `app/` is a route module
 * and ships in the bundle (`lib/routes.spec.ts`).
 */

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  sendMagicLink: vi.fn(),
  resendConfirmation: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: "unauthenticated",
    isConfigured: true,
    callbackError: null,
    sendMagicLink: auth.sendMagicLink,
    resendConfirmation: auth.resendConfirmation,
    signInWithOAuthProvider: vi.fn(),
    signInWithPassword: auth.signInWithPassword,
    signOut: vi.fn(),
  }),
}));

import SignIn from "@/app/(auth)/sign-in";

type Node = ReactTestRenderer["root"];

/** auth-js's `AuthApiError` shape, as GoTrue answers. */
function gotrue(message: string, status: number, code: string) {
  return Object.assign(new Error(message), { name: "AuthApiError", status, code });
}

const EMAIL = "brother@westfield.edu";

function isHost(node: Node, name: string): boolean {
  return (node.type as unknown) === name;
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
  act(() => {
    pressableLabelled(tree.root, "Continue with email").props.onPress();
  });
  return tree;
}

function pressableLabelled(root: Node, label: string): Node {
  const found = findPressable(root, label);
  if (!found) throw new Error(`no pressable labelled ${label}`);
  return found;
}

function findPressable(root: Node, label: string): Node | undefined {
  return root
    .findAll((node) => isHost(node, "Pressable"))
    .find(
      (pressable) =>
        pressable.props.accessibilityLabel === label ||
        pressable
          .findAll((node) => isHost(node, "Text"))
          .some((text) => text.props.children === label),
    );
}

function field(root: Node, contentType: "username" | "password"): Node {
  const [input] = root.findAll(
    (node) =>
      isHost(node, "TextInput") && node.props.textContentType === contentType,
  );
  return input!;
}

function texts(root: Node): string[] {
  return root
    .findAll((node) => isHost(node, "Text"))
    .map((node) => node.props.children)
    .filter((children): children is string => typeof children === "string");
}

async function signIn(tree: ReactTestRenderer, email = EMAIL) {
  act(() => {
    field(tree.root, "username").props.onChangeText(email);
    field(tree.root, "password").props.onChangeText("hunter22");
  });
  await act(async () => {
    pressableLabelled(tree.root, "Sign in").props.onPress();
  });
}

async function sendLink(tree: ReactTestRenderer) {
  act(() => {
    pressableLabelled(tree.root, "Magic link").props.onPress();
    field(tree.root, "username").props.onChangeText(EMAIL);
  });
  await act(async () => {
    pressableLabelled(tree.root, "Email me a link").props.onPress();
  });
}

beforeEach(() => {
  auth.signInWithPassword.mockReset();
  auth.sendMagicLink.mockReset();
  auth.resendConfirmation.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sign-in refusals in Frapp's words", () => {
  it("says a wrong password doesn't match, never GoTrue's sentence", async () => {
    auth.signInWithPassword.mockRejectedValue(
      gotrue("Invalid login credentials", 400, "invalid_credentials"),
    );
    const tree = render();
    await signIn(tree);

    expect(texts(tree.root)).toContain(WRONG_CREDENTIALS_COPY);
    expect(texts(tree.root)).not.toContain("Invalid login credentials");
    expect(findPressable(tree.root, "Resend email")).toBeUndefined();
  });

  it("drops a sentence it doesn't know for the fallback", async () => {
    auth.signInWithPassword.mockRejectedValue(
      gotrue("User is banned", 400, "user_banned"),
    );
    const tree = render();
    await signIn(tree);

    expect(texts(tree.root)).not.toContain("User is banned");
    expect(texts(tree.root)).toContain("Something went wrong. Please try again.");
  });

  it("tells a magic link inside the email minute that one already went out", async () => {
    auth.sendMagicLink.mockRejectedValue(
      gotrue(
        "For security purposes, you can only request this after 44 seconds.",
        429,
        "over_email_send_rate_limit",
      ),
    );
    const tree = render();
    await sendLink(tree);

    expect(texts(tree.root)).toContain(cooldownCopy(44));
    expect(texts(tree.root).join(" ")).not.toMatch(/For security purposes/);
  });
});

describe("an address that was never confirmed", () => {
  const unconfirmed = () => gotrue("Email not confirmed", 400, "email_not_confirmed");

  it("asks the member to confirm, and offers to send the email again", async () => {
    auth.signInWithPassword.mockRejectedValue(unconfirmed());
    const tree = render();
    await signIn(tree);

    expect(texts(tree.root)).toContain(UNCONFIRMED_EMAIL_COPY);
    expect(texts(tree.root)).not.toContain("Email not confirmed");
    expect(findPressable(tree.root, "Resend email")).toBeDefined();
  });

  it("resends to the refused address, then waits out GoTrue's minute", async () => {
    vi.useFakeTimers();
    auth.signInWithPassword.mockRejectedValue(unconfirmed());
    auth.resendConfirmation.mockResolvedValue(undefined);
    const tree = render();
    await signIn(tree);

    await act(async () => {
      pressableLabelled(tree.root, "Resend email").props.onPress();
    });

    expect(auth.resendConfirmation).toHaveBeenCalledWith({ email: EMAIL });
    expect(texts(tree.root)).toContain(
      `We sent a new link to ${EMAIL}. Open it on this phone to finish signing in.`,
    );
    const waiting = pressableLabelled(tree.root, "Resend email in 60s");
    expect(waiting.props.disabled).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(findPressable(tree.root, "Resend email in 59s")).toBeDefined();
  });

  it("starts the count from GoTrue's seconds when the resend lands inside the minute", async () => {
    auth.signInWithPassword.mockRejectedValue(unconfirmed());
    auth.resendConfirmation.mockRejectedValue(
      gotrue(
        "For security purposes, you can only request this after 30 seconds.",
        429,
        "over_email_send_rate_limit",
      ),
    );
    const tree = render();
    await signIn(tree);

    await act(async () => {
      pressableLabelled(tree.root, "Resend email").props.onPress();
    });

    expect(texts(tree.root)).toContain(cooldownCopy(30));
    expect(pressableLabelled(tree.root, "Resend email in 30s").props.disabled).toBe(true);
  });

  it("drops the offer once the email is edited", async () => {
    auth.signInWithPassword.mockRejectedValue(unconfirmed());
    const tree = render();
    await signIn(tree);

    act(() => {
      field(tree.root, "username").props.onChangeText("other@westfield.edu");
    });

    expect(findPressable(tree.root, "Resend email")).toBeUndefined();
  });
});
