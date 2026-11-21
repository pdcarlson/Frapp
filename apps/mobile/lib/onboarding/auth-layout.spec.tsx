/** @vitest-environment jsdom */
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The `(auth)` layout's routing for a member's invite to another chapter
 * (#4341), tested here because a spec under `app/` ships as a route module.
 */

const gate = vi.hoisted(() => ({ destination: "tabs" as string }));
vi.mock("@/lib/onboarding/use-auth-gate", () => ({
  useAuthGateDestination: () => gate.destination,
}));

import AuthLayout from "@/app/(auth)/_layout";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<AuthLayout />);
  });
  return tree;
}

function redirectTarget(tree: ReactTestRenderer): unknown {
  const found = tree.root.findAll(
    (node) => (node.type as unknown) === "Redirect",
  );
  return found[0]?.props.href ?? null;
}

beforeEach(() => {
  gate.destination = "tabs";
  vi.mocked(usePathname).mockReturnValue("/");
  vi.mocked(useGlobalSearchParams).mockReturnValue({});
});

describe("(auth) layout and the second-chapter card (#4341)", () => {
  it("sends a member's invite link from /join to the card", () => {
    vi.mocked(usePathname).mockReturnValue("/join");
    vi.mocked(useGlobalSearchParams).mockReturnValue({ token: "token-bbbb" });
    const tree = render();
    expect(redirectTarget(tree)).toEqual({
      pathname: "/join-another",
      params: { token: "token-bbbb" },
    });
    act(() => tree.unmount());
  });

  it("keeps a member on the card rather than bouncing them to the tabs", () => {
    vi.mocked(usePathname).mockReturnValue("/join-another");
    const tree = render();
    expect(redirectTarget(tree)).toBeNull();
    act(() => tree.unmount());
  });

  it("still bounces a member off s02 with no invite in the link", () => {
    vi.mocked(usePathname).mockReturnValue("/join");
    const tree = render();
    expect(redirectTarget(tree)).toBe("/");
    act(() => tree.unmount());
  });
});
