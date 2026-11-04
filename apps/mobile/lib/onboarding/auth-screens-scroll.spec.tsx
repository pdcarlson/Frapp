/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * The `(auth)` columns must scroll.
 *
 * Sign-in was a centred `View` with no scroll container. On a 375x667 screen
 * (iPhone SE, and an iPhone-only app on an iPad) its column is ~880pt tall, and
 * `justifyContent: "center"` overflows both ends rather than clamping — so the
 * "Sign in" button sat below the bottom edge with no way to reach it, on the
 * first screen App Review opens. Measured on Expo web before the fix: the
 * button's text at y≈700–717 in a 667pt viewport.
 *
 * A layout bug is not visible to a node renderer, so these pin the structure
 * that prevents it: every control is inside a `ScrollView` whose content can
 * grow past the viewport, under a safe area, with taps on a control landing
 * while the keyboard is up. The chapter picker had the same centred-`View`
 * shape around an unbounded list and gets the same guard.
 *
 * They live here, not beside the screens: a spec under `app/` is a route
 * module and ships in the bundle (`lib/routes.spec.ts`).
 */

// Sign-in renders only signed out, and the picker only signed in (a stale
// `frapp://chapter-picker` opened signed out redirects), so each suite sets it.
const session = vi.hoisted(() => ({ status: "unauthenticated" }));

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

vi.mock("@/lib/select-chapter", () => ({
  useSelectChapter: () => vi.fn().mockResolvedValue(true),
}));

const chapters = Array.from({ length: 12 }, (_, index) => ({
  chapter_id: `chapter-${index}`,
  chapter: { name: `Chapter ${index}`, university: "Westfield" },
}));

vi.mock("@repo/hooks", () => ({
  useListChapters: () => ({
    data: chapters,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import SignIn from "@/app/(auth)/sign-in";
import ChapterPicker from "@/app/(auth)/chapter-picker";

type Node = ReactTestRenderer["root"];

function render(screen: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{screen}</FrappThemeProvider>);
  });
  return tree;
}

/**
 * Host-string matching, as `lib/onboarding/join-screen.spec.tsx` explains:
 * `vitest.setup.ts` mocks react-native's hosts as strings, which `tsc` cannot
 * see, hence the `unknown` casts.
 */
function isHost(node: Node, name: string): boolean {
  return (node.type as unknown) === name;
}

function ancestors(node: Node): Node[] {
  const chain: Node[] = [];
  for (let at = node.parent; at; at = at.parent) chain.push(at);
  return chain;
}

function pressableLabelled(root: Node, label: string): Node | undefined {
  return root
    .findAll((node) => isHost(node, "Pressable"))
    .find((pressable) =>
      pressable
        .findAll((node) => isHost(node, "Text"))
        .some((text) => text.props.children === label),
    );
}

/** Flattens the style arrays these screens pass, which the mock leaves alone. */
function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flat));
  }
  return (style ?? {}) as Record<string, unknown>;
}

/** The one scroll container, and that it can grow past the viewport. */
function expectScrollingColumn(root: Node, controls: Node[]) {
  const scrolls = root.findAll((node) => isHost(node, "ScrollView"));
  expect(scrolls).toHaveLength(1);
  const [scroll] = scrolls;

  for (const control of controls) {
    expect(ancestors(control)).toContain(scroll);
  }

  // `flexGrow`, not `flex`: the content keeps its natural height when it is
  // taller than the screen, and fills (and centres in) the screen when not.
  const content = flat(scroll.props.contentContainerStyle);
  expect(content.flexGrow).toBe(1);
  expect(content.flex).toBeUndefined();
  // A tap on a control must land while the keyboard is up, not just dismiss it.
  expect(scroll.props.keyboardShouldPersistTaps).toBe("handled");

  const safeAreas = ancestors(scroll).filter((node) =>
    isHost(node, "SafeAreaView"),
  );
  expect(safeAreas).toHaveLength(1);
  expect(safeAreas[0].props.edges).toEqual(
    expect.arrayContaining(["top", "bottom"]),
  );
  return scroll;
}

describe("sign-in (s01)", () => {
  beforeEach(() => {
    session.status = "unauthenticated";
  });

  it("puts the whole form, down to the Sign in button, inside one scroll container", () => {
    const tree = render(<SignIn />);

    const signIn = pressableLabelled(tree.root, "Sign in");
    const email = tree.root.findAll(
      (node) =>
        isHost(node, "TextInput") && node.props.textContentType === "username",
    );
    const password = tree.root.findAll(
      (node) =>
        isHost(node, "TextInput") && node.props.textContentType === "password",
    );
    expect(signIn).toBeDefined();
    expect(email).toHaveLength(1);
    expect(password).toHaveLength(1);

    const scroll = expectScrollingColumn(tree.root, [
      signIn!,
      email[0],
      password[0],
    ]);
    // iOS: insets the scroll view by the keyboard and scrolls the focused
    // field above it (the screen's comment has the RN source for that).
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
  });

  it("breaks the tagline after “needs”, whatever the screen width", () => {
    const tree = render(<SignIn />);
    const [tagline] = tree.root.findAll(
      (node) =>
        isHost(node, "Text") &&
        node.props.children ===
          "Everything your chapter needs is already in chat.",
    );
    expect(tagline).toBeDefined();

    // Figtree 400 at 16pt, measured on Expo web: "Everything your chapter
    // needs" is 219.5pt and "… needs is" 234.6pt. A cap strictly between the
    // two puts the break after "needs" on every phone, instead of leaving
    // "chat." alone on line 2 at 360–393pt widths.
    const { maxWidth } = flat(tagline.props.style);
    expect(maxWidth).toBeGreaterThan(219.5);
    expect(maxWidth).toBeLessThan(234.6);
  });
});

describe("chapter picker", () => {
  beforeEach(() => {
    session.status = "authenticated";
  });

  it("scrolls the whole column, so Sign out stays reachable under a long list", () => {
    const tree = render(<ChapterPicker />);

    const rows = chapters.map((row) =>
      pressableLabelled(tree.root, row.chapter.name),
    );
    const signOut = pressableLabelled(tree.root, "Sign out");
    expect(rows.every((row) => row !== undefined)).toBe(true);
    expect(signOut).toBeDefined();

    expectScrollingColumn(tree.root, [...(rows as Node[]), signOut!]);
  });
});
