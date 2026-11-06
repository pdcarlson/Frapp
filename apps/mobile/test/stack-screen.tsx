import React from "react";
import { vi } from "vitest";
import {
  NavigationContext,
  NavigationRouteContext,
} from "expo-router/react-navigation";
import type { StackRoute } from "@/lib/back-target";

type FakeNavigation = {
  goBack: ReturnType<typeof vi.fn>;
  setOptions: ReturnType<typeof vi.fn>;
  getState: () => { type: string; routes: StackRoute[] };
};

/**
 * Renders `children` as the top screen of a stack whose routes are `below`
 * plus one more, the way React Navigation's providers hand a pushed screen
 * its navigation and route (`vitest.setup.ts` mocks both contexts empty).
 * Returns the fake navigation, so a spec can assert on `goBack` and
 * `setOptions`.
 */
export function stackScreen(
  below: readonly Omit<StackRoute, "key">[],
  children: React.ReactNode,
  type = "stack",
  /** Reuse one screen's navigation across renders, as a re-render does. */
  reuse?: FakeNavigation,
) {
  const routes: StackRoute[] = [
    ...below.map((route, i) => ({ ...route, key: `below-${i}` })),
    { key: "this-screen", name: "this-screen" },
  ];
  const navigation: FakeNavigation = reuse ?? {
    goBack: vi.fn(),
    setOptions: vi.fn(),
    getState: () => ({ type, routes }),
  };
  const element = (
    <NavigationContext.Provider value={navigation as never}>
      <NavigationRouteContext.Provider value={routes.at(-1) as never}>
        {children}
      </NavigationRouteContext.Provider>
    </NavigationContext.Provider>
  );
  return { element, navigation };
}
