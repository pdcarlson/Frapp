/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * The keyboard's return key on sign-in (s01).
 *
 * In password mode return on the email field moves to the password field, and
 * return on the password field signs in. In magic-link mode return on the
 * email field sends the link. Either way return goes through the same submit
 * as the button, so it gets the button's guard: nothing new starts while a
 * sign-in is in flight.
 *
 * Here rather than beside the screen: a spec under `app/` is a route module
 * and ships in the bundle (`lib/routes.spec.ts`).
 */

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  sendMagicLink: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: "unauthenticated",
    isConfigured: true,
    callbackError: null,
    sendMagicLink: auth.sendMagicLink,
    signInWithOAuthProvider: vi.fn(),
    signInWithPassword: auth.signInWithPassword,
    signOut: vi.fn(),
  }),
}));

import SignIn from "@/app/(auth)/sign-in";

type Node = ReactTestRenderer["root"];

const focusPassword = vi.fn();

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SignIn />
      </FrappThemeProvider>,
      {
        // `vitest.setup.ts` mocks react-native's hosts as strings, so a ref on
        // one is `null` unless the renderer is told what to hand back. Only the
        // password field's ref is read.
        createNodeMock: (element) =>
          (element.props as { textContentType?: string }).textContentType ===
          "password"
            ? { focus: focusPassword }
            : null,
      },
    );
  });
  return tree;
}

/**
 * Host-string matching, as `lib/onboarding/join-screen.spec.tsx` explains;
 * the casts are because `tsc` cannot see the mocked hosts.
 */
function isHost(node: Node, name: string): boolean {
  return (node.type as unknown) === name;
}

function field(root: Node, contentType: "username" | "password"): Node {
  const [input] = root.findAll(
    (node) =>
      isHost(node, "TextInput") && node.props.textContentType === contentType,
  );
  return input;
}

function hasField(root: Node, contentType: "username" | "password"): boolean {
  return (
    root.findAll(
      (node) =>
        isHost(node, "TextInput") && node.props.textContentType === contentType,
    ).length > 0
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

function type(input: Node, value: string) {
  act(() => {
    input.props.onChangeText(value);
  });
}

function pressReturn(input: Node) {
  act(() => {
    input.props.onSubmitEditing();
  });
}

beforeEach(() => {
  auth.signInWithPassword.mockReset();
  auth.sendMagicLink.mockReset();
  focusPassword.mockReset();
});

describe("sign-in return key, password mode", () => {
  it("moves from email to password without dropping the keyboard", () => {
    const tree = render();
    const email = field(tree.root, "username");

    expect(email.props.returnKeyType).toBe("next");
    // "submit" keeps focus through the submit; the default single-line
    // behaviour blurs first, which drops and re-raises the keyboard.
    expect(email.props.submitBehavior).toBe("submit");

    type(email, "brother@westfield.edu");
    pressReturn(field(tree.root, "username"));

    expect(focusPassword).toHaveBeenCalledTimes(1);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in from the password field with the button's normalised input", async () => {
    auth.signInWithPassword.mockResolvedValue(undefined);
    const tree = render();

    type(field(tree.root, "username"), "  Brother@Westfield.edu ");
    type(field(tree.root, "password"), "hunter22");
    const password = field(tree.root, "password");
    expect(password.props.returnKeyType).toBe("go");

    await act(async () => {
      password.props.onSubmitEditing();
    });

    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "brother@westfield.edu",
      password: "hunter22",
    });
  });

  it("validates like the button when the password is empty", () => {
    const tree = render();
    type(field(tree.root, "username"), "brother@westfield.edu");

    pressReturn(field(tree.root, "password"));

    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(
      tree.root.findAll(
        (node) =>
          isHost(node, "Text") &&
          node.props.children === "Enter your password before continuing.",
      ),
    ).toHaveLength(1);
  });

  it("does nothing while a sign-in is already in flight", () => {
    // Never settles, so the screen stays in its submitting state.
    auth.signInWithPassword.mockReturnValue(new Promise(() => {}));
    const tree = render();
    type(field(tree.root, "username"), "brother@westfield.edu");
    type(field(tree.root, "password"), "hunter22");

    pressReturn(field(tree.root, "password"));
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);

    // The button is disabled now; return must be held to the same guard.
    expect(pressableLabelled(tree.root, "Signing in...").props.disabled).toBe(
      true,
    );
    pressReturn(field(tree.root, "password"));
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });
});

describe("sign-in return key, magic-link mode", () => {
  it("sends the link from the email field, which is the last field", async () => {
    auth.sendMagicLink.mockResolvedValue(undefined);
    const tree = render();

    act(() => {
      pressableLabelled(tree.root, "Magic Link").props.onPress();
    });
    expect(hasField(tree.root, "password")).toBe(false);

    const email = field(tree.root, "username");
    expect(email.props.returnKeyType).toBe("send");
    type(email, "brother@westfield.edu");

    await act(async () => {
      field(tree.root, "username").props.onSubmitEditing();
    });

    expect(focusPassword).not.toHaveBeenCalled();
    expect(auth.sendMagicLink).toHaveBeenCalledTimes(1);
    expect(auth.sendMagicLink).toHaveBeenCalledWith({
      email: "brother@westfield.edu",
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});
