/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";

/**
 * #3022. Two More destinations with no screen spec of their own, s11 Dues and
 * s12 Documents, render here with every query still loading, to pin that they
 * draw the board's `‹ More` and that it goes there. The others are pinned in
 * their own screen specs (s16's in `settings-screen.spec.tsx`). It lives under `lib/`
 * because a spec under `app/` ships as a route module (`lib/routes.spec.ts`).
 *
 * Every `use*` export of `@repo/hooks` becomes a query that hasn't answered
 * yet, and every mutation an idle one: the back row is drawn before any of
 * the screen's data, which is the state a member opening a slow screen sees.
 */
vi.mock("@repo/hooks", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const loading = {
    data: undefined,
    isPending: true,
    isLoading: true,
    isSuccess: false,
    isError: false,
    isFetching: true,
    error: null,
    refetch: vi.fn(),
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    reset: vi.fn(),
  };
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      // `usePermissionList` returns the list itself, `[]` while loading.
      name === "usePermissionList"
        ? () => []
        : /^use[A-Z]/.test(name) && typeof value === "function"
          ? () => loading
          : value,
    ]),
  );
});

// s11 reaches the Stripe module through `lib/expo-go.ts`, which reads the
// execution environment; under vitest there is none, so it says "a store
// build", as `lib/chat/chat-thread-screen.spec.tsx` does.
vi.mock("expo-constants", () => ({
  default: { executionEnvironment: "storeClient" },
  ExecutionEnvironment: {
    Bare: "bare",
    Standalone: "standalone",
    StoreClient: "storeClient",
  },
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentPrimary: "#EFB63B",
    accentOnPrimary: "#131211",
    logoUrl: null,
    chapterName: null,
  }),
}));

import DuesScreen from "@/app/(app)/dues";
import DocumentsScreen from "@/app/(app)/documents";

const mounted: ReactTestRenderer[] = [];

function render(screen: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{screen}</FrappThemeProvider>);
  });
  mounted.push(tree);
  return tree;
}

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

describe("More destinations draw ‹ More (#3022)", () => {
  it.each([
    ["s11 Dues", () => <DuesScreen />],
    ["s12 Documents", () => <DocumentsScreen />],
  ])("%s", (_name, screen) => {
    expectBackRow(render(screen()), "More", "/more");
  });
});
