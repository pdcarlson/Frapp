/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useLocalSearchParams, useRouter } from "expo-router";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * The second-chapter invite card (#4341): `app/(auth)/join-another.tsx`,
 * tested here because a spec under `app/` ships as a route module.
 */

const card = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
vi.mock("@/components/onboarding/join-with-invite", () => ({
  JoinWithInvite: (props: Record<string, unknown>) => {
    card.props = props;
    return props.header as React.ReactNode;
  },
}));

import JoinAnotherChapter from "@/app/(auth)/join-another";
import {
  consumeRememberedInviteToken,
  peekRememberedInviteToken,
  rememberInviteToken,
} from "@/lib/onboarding/invite-token";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <JoinAnotherChapter />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

// The shared `expo-router` mock's stable `vi.fn()`s (`vitest.setup.ts`).
const router = vi.mocked(useRouter)() as unknown as Record<
  "back" | "replace" | "canGoBack",
  Mock
>;

function backRow(tree: ReactTestRenderer) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "Back to your chapter",
  );
}

beforeEach(() => {
  card.props = null;
  consumeRememberedInviteToken();
  router.back.mockReset();
  router.replace.mockReset();
  router.canGoBack.mockReset().mockReturnValue(true);
  vi.mocked(useLocalSearchParams).mockReturnValue({ token: "token-bbbb" });
});

describe("Join another chapter (#4341)", () => {
  it("shows the invite card for the link's invite, signed in, with no sign-in of its own", () => {
    const tree = render();
    expect(card.props?.token).toBe("token-bbbb");
    expect(card.props?.then).toBeNull();
    expect(card.props?.accountLine).toBeUndefined();
    tree.unmount();
  });

  it("backs out to the chapter they were in, declining the invite", () => {
    rememberInviteToken("token-bbbb");
    const tree = render();
    act(() => backRow(tree).props.onPress());
    expect(peekRememberedInviteToken()).toBeNull();
    expect(router.back).toHaveBeenCalled();
    tree.unmount();
  });

  it("goes to the tabs when nothing is under it", () => {
    router.canGoBack.mockReturnValue(false);
    const tree = render();
    act(() => backRow(tree).props.onPress());
    expect(router.replace).toHaveBeenCalledWith("/");
    tree.unmount();
  });

  it("holds Back while a join runs", () => {
    const tree = render();
    act(() => (card.props?.onBusyChange as (busy: boolean) => void)(true));
    act(() => backRow(tree).props.onPress?.());
    expect(router.back).not.toHaveBeenCalled();
    tree.unmount();
  });

  it("shows another invite pasted on its not-an-invite screen", () => {
    const tree = render();
    act(() =>
      (card.props?.onOtherInvite as (token: string) => void)("token-cccc"),
    );
    expect(card.props?.token).toBe("token-cccc");
    expect(peekRememberedInviteToken()).toBe("token-cccc");
    tree.unmount();
  });

  it("keeps a pasted invite when its join fails", () => {
    const tree = render();
    act(() =>
      (card.props?.onOtherInvite as (token: string) => void)("token-cccc"),
    );
    const setBusy = card.props?.onBusyChange as (busy: boolean) => void;
    act(() => setBusy(true));
    act(() => setBusy(false));
    expect(card.props?.token).toBe("token-cccc");
    tree.unmount();
  });

  it("forgets the invite however the card closes, so it doesn't come back", () => {
    // iOS's edge swipe pops the screen without its Back row.
    const tree = render();
    rememberInviteToken("token-bbbb");
    act(() => tree.unmount());
    expect(peekRememberedInviteToken()).toBeNull();
  });
});
