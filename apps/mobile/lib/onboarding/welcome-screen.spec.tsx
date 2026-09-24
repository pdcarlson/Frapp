/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FrappThemeProvider } from "@/lib/theme";

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

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useListChapters: () => ({ data: [] }),
  useChannels: () => ({ isPending: false, isError: false, data: [] }),
  useUpdateOnboarding: () => ({ mutateAsync: vi.fn() }),
}));

import Welcome from "@/app/(auth)/welcome";

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
});
