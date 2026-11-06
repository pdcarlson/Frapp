/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { flatStyle } from "@/test/flat-style";

/**
 * #2299. s03 is the first screen after joining a chapter, for a new member and
 * for an App Reviewer alike. In a build that cannot push (`isPushAvailable()`
 * false; `spec/ui/mobile/patterns.md` § Push notifications lists the causes)
 * it used to show the push primer with "Turn on" disabled and a build-status
 * apology under it. These pin that the card is not drawn there, and that it
 * still is, with a working "Turn on", when push can be turned on. `lib/notifications/primer.spec.ts` covers the
 * rule itself; this covers the screen wiring it.
 *
 * It renders `app/(auth)/welcome.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

let pushAvailable = false;
let permission: { granted: boolean } | null = null;

vi.mock("@/lib/notifications/push", () => ({
  isPushAvailable: () => pushAvailable,
  getPushPermission: () => Promise.resolve(permission),
  requestPushPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ status: "authenticated", chapterId: null }),
}));

const completeOnboarding = vi.fn().mockResolvedValue(undefined);

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useListChapters: () => ({
    data: [
      {
        chapter: {
          id: "ch-1",
          name: "FIJI Tau Nu",
          university: "Rensselaer Polytechnic Institute",
        },
      },
    ],
  }),
  useChannels: () => ({ isPending: false, isError: false, data: [] }),
  useUpdateOnboarding: () => ({ mutateAsync: completeOnboarding }),
}));

import { useRouter } from "expo-router";
import Welcome from "@/app/(auth)/welcome";
import { requestPushPermission } from "@/lib/notifications/push";

type Node = ReactTestRenderer["root"];

async function render(): Promise<ReactTestRenderer> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <FrappThemeProvider>
          <Welcome />
        </FrappThemeProvider>
      </QueryClientProvider>,
    );
  });
  // Let the primer-decision and permission reads resolve, so the screen shows
  // what they said rather than its first frame.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  return tree;
}

const texts = (root: Node) =>
  root
    .findAllByType("Text" as never, { deep: true })
    .map((text) => JSON.stringify(text.props.children ?? ""));

const turnOn = (root: Node) =>
  root
    .findAllByType("Pressable" as never, { deep: true })
    .find(
      (pressable) =>
        pressable.props.accessibilityLabel === "Turn on notifications",
    );

describe("s03 welcome, push primer (#2299)", () => {
  beforeEach(() => {
    pushAvailable = false;
    permission = null;
  });

  it("draws no primer card when push is unavailable", async () => {
    const { root } = await render();

    expect(turnOn(root)).toBeUndefined();
    expect(texts(root).some((t) => t.includes("miss @channel"))).toBe(false);
    // Nor the reason line the dead card used to print.
    expect(texts(root).some((t) => t.includes("Notifications"))).toBe(false);
    // The rest of the screen is intact.
    expect(texts(root).some((t) => t.includes("in."))).toBe(true);
  });

  it("draws the card with a working Turn on when push can be turned on", async () => {
    pushAvailable = true;
    permission = { granted: false };

    const { root } = await render();

    expect(texts(root).some((t) => t.includes("miss @channel"))).toBe(true);
    const button = turnOn(root);
    expect(button).toBeDefined();
    expect(button?.props.disabled).toBe(false);
  });

  it("hides the card once Turn on is answered, even with Don't Allow", async () => {
    // A denial leaves the permission not granted, so only the recorded
    // decision hides the card. Left up, it would offer a "Turn on" that iOS
    // now ignores, until the screen remounted.
    pushAvailable = true;
    permission = { granted: false };
    vi.mocked(requestPushPermission).mockClear().mockResolvedValueOnce(false);

    const { root } = await render();
    await act(async () => {
      turnOn(root)?.props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(requestPushPermission).toHaveBeenCalledTimes(1);
    expect(turnOn(root)).toBeUndefined();
    expect(texts(root).some((t) => t.includes("miss @channel"))).toBe(false);
  });
});

/**
 * #3352. "You're in." follows the #3348 screen rules: the chapter named under
 * the title, and one button pinned under the scroll, where a Skip that did
 * the same thing used to sit beside it.
 */
describe("s03 welcome, screen rules (#3352)", () => {
  beforeEach(() => {
    pushAvailable = false;
    permission = null;
    completeOnboarding.mockClear();
  });

  it("names the chapter and pins one button, Go to chat, outside the scroll", async () => {
    const { root } = await render();

    expect(
      texts(root).some((t) =>
        t.includes("FIJI Tau Nu · Rensselaer Polytechnic Institute"),
      ),
    ).toBe(true);
    const buttons = root
      .findAllByType("Pressable" as never, { deep: true })
      .filter((p) => p.props.accessibilityRole === "button");
    expect(buttons).toHaveLength(1);
    expect(
      root
        .findByType("ScrollView" as never)
        .findAllByType("Pressable" as never, { deep: true }),
    ).toHaveLength(0);
    expect(texts(root).some((t) => t.includes("Skip"))).toBe(false);

    await act(async () => {
      await buttons[0]?.props.onPress();
    });
    expect(completeOnboarding).toHaveBeenCalledWith({
      has_completed_onboarding: true,
    });
    expect(vi.mocked(useRouter)().replace).toHaveBeenCalledWith("/");
  });

  it("draws the primer inside the scroll, so Go to chat stays the one pinned control", async () => {
    pushAvailable = true;
    permission = { granted: false };
    const { root } = await render();

    const scroll = root.findByType("ScrollView" as never);
    expect(
      scroll
        .findAllByType("Pressable" as never, { deep: true })
        .some((p) => p.props.accessibilityLabel === "Turn on notifications"),
    ).toBe(true);
    const outside = root
      .findAllByType("Pressable" as never, { deep: true })
      .filter(
        (p) =>
          !scroll
            .findAllByType("Pressable" as never, { deep: true })
            .includes(p),
      );
    expect(outside).toHaveLength(1);
  });
});

/**
 * One gold button on s03. While the primer asks, its "Turn on" is the gold
 * one and "Go to chat" is the outlined Secondary under it, as the board draws
 * s03; with no primer, "Go to chat" is the step forward and takes the gold.
 */
describe("s03 welcome, one gold button", () => {
  const goToChat = (root: Node) =>
    root
      .findAllByType("Pressable" as never, { deep: true })
      .find((pressable) =>
        pressable
          .findAllByType("Text" as never, { deep: true })
          .some((text) => text.props.children === "Go to chat"),
      );

  /** A Pressable's resting fill. */
  const fill = (pressable: Node | undefined): unknown =>
    flatStyle(pressable?.props.style).backgroundColor;

  beforeEach(() => {
    pushAvailable = false;
    permission = null;
  });

  it("outlines Go to chat while the primer's Turn on is the gold button", async () => {
    pushAvailable = true;
    permission = { granted: false };
    const { root } = await render();

    expect(fill(turnOn(root))).toBe(signetDarkTokens.color.gold.house);
    expect(fill(goToChat(root))).toBe(signetDarkTokens.color.surface.card);
  });

  it("makes Go to chat the gold button when there is no primer", async () => {
    const { root } = await render();

    expect(fill(goToChat(root))).toBe(signetDarkTokens.color.gold.house);
  });

  it("spins under the same label while it leaves, rather than renaming itself", async () => {
    completeOnboarding.mockReturnValueOnce(new Promise(() => {}));
    const { root } = await render();
    act(() => {
      void goToChat(root)?.props.onPress();
    });

    const button = root
      .findAllByType("Pressable" as never, { deep: true })
      .find((pressable) => pressable.props.accessibilityLabel === "Go to chat");
    expect(button?.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(texts(root).some((t) => t.includes("Opening chat"))).toBe(false);
  });

  it("spins under the same label as the outlined button, while the primer shows", async () => {
    pushAvailable = true;
    permission = { granted: false };
    completeOnboarding.mockReturnValueOnce(new Promise(() => {}));
    const { root } = await render();
    act(() => {
      void goToChat(root)?.props.onPress();
    });

    const button = root
      .findAllByType("Pressable" as never, { deep: true })
      .find((pressable) => pressable.props.accessibilityLabel === "Go to chat");
    // Still the outlined one: Turn on keeps the gold.
    expect(fill(button)).toBe(signetDarkTokens.color.surface.card);
    expect(button?.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(
      button?.findAllByType("ActivityIndicator" as never, { deep: true }),
    ).toHaveLength(1);
  });
});
