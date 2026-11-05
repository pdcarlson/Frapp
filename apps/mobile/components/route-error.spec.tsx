/** @vitest-environment jsdom */
import React, { act } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import * as Sentry from "@sentry/react-native";
import { useRouter } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

// `state-block` imports chapter branding for its empty state, which would drag
// the API client into a spec about error boundaries (see state-block.spec.tsx).
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentPrimary: "#F4CB63",
    accentOnPrimary: "#2B2009",
    logoUrl: null,
    chapterName: null,
  }),
}));

import {
  APP_ERROR_COPY,
  AppErrorScreen,
  RouteErrorBoundary,
  SCREEN_ERROR_COPY,
  screenErrorLayout,
} from "./route-error";

/**
 * #3378: a render error used to take the whole app down, with no recovery
 * screen and no route on the Sentry event. These pin the fallback each
 * boundary draws, that the error reaches Sentry exactly once with the boundary
 * and route on it, and that the layouts actually mount the boundaries.
 */

const captureException = vi.mocked(Sentry.captureException);

/** A child that throws while `state.fail` is set, and renders text otherwise. */
function makeBomb(...thrown: [unknown?]) {
  // A rest parameter, not a default, so `makeBomb(undefined)` throws undefined.
  const error = thrown.length > 0 ? thrown[0] : new Error("Cannot read properties of undefined");
  const state = { fail: true, error };
  function Bomb() {
    if (state.fail) throw state.error;
    return <Text>Screen content</Text>;
  }
  return { Bomb, state };
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType("Text" as unknown as React.ComponentType)
    .flatMap((node) =>
      node.children.filter((child): child is string => typeof child === "string"),
    );
}

function pressables(tree: ReactTestRenderer) {
  return tree.root.findAllByType("Pressable" as unknown as React.ComponentType);
}

function press(tree: ReactTestRenderer, label: string) {
  const button = pressables(tree).find(
    (node) => node.props.accessibilityLabel === label,
  );
  if (!button) throw new Error(`No control labelled ${label}`);
  act(() => {
    button.props.onPress();
  });
}

function renderInTheme(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

beforeEach(() => {
  vi.clearAllMocks();
  // React logs every caught render error; the boundary is the thing under test.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a screen's boundary", () => {
  it("draws the screen fallback in place of a screen that throws", () => {
    const { Bomb } = makeBomb();
    const tree = renderInTheme(
      <RouteErrorBoundary route="events" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    expect(texts(tree)).toEqual(
      expect.arrayContaining([SCREEN_ERROR_COPY.title, SCREEN_ERROR_COPY.body]),
    );
    expect(texts(tree)).not.toContain("Screen content");
  });

  it("never shows the raw error text", () => {
    const { Bomb } = makeBomb(new Error("Jamie Rivera's note is undefined"));
    const tree = renderInTheme(
      <RouteErrorBoundary route="events" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    expect(texts(tree).join(" ")).not.toContain("Jamie Rivera");
  });

  it("reports to Sentry with the boundary and the route", () => {
    const error = new Error("boom");
    const { Bomb } = makeBomb(error);
    renderInTheme(
      <RouteErrorBoundary route="event-details" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { error_boundary: "screen", route_name: "event-details" },
    });
  });

  it("puts the screen back on Retry once it renders again", () => {
    const { Bomb, state } = makeBomb();
    const tree = renderInTheme(
      <RouteErrorBoundary route="events" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    state.fail = false;
    press(tree, SCREEN_ERROR_COPY.retry);

    expect(texts(tree)).toContain("Screen content");
    expect(texts(tree)).not.toContain(SCREEN_ERROR_COPY.title);
  });

  it("reports one error once, however many times Retry throws it again", () => {
    const { Bomb } = makeBomb(new Error("same object"));
    const tree = renderInTheme(
      <RouteErrorBoundary route="events" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    press(tree, SCREEN_ERROR_COPY.retry);
    press(tree, SCREEN_ERROR_COPY.retry);

    expect(texts(tree)).toContain(SCREEN_ERROR_COPY.title);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("shows the fallback for a thrown non-error too", () => {
    const { Bomb } = makeBomb(undefined);
    const tree = renderInTheme(
      <RouteErrorBoundary route="events" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    expect(texts(tree)).toContain(SCREEN_ERROR_COPY.title);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("offers Back to chat off Chat home, and it goes to Chat home", () => {
    const { Bomb } = makeBomb();
    const tree = renderInTheme(
      <RouteErrorBoundary route="chat-thread" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    press(tree, SCREEN_ERROR_COPY.back);

    expect(vi.mocked(useRouter)().navigate).toHaveBeenCalledWith("/(tabs)");
  });

  it("offers only Retry on Chat home, which is where Back to chat goes", () => {
    const { Bomb } = makeBomb();
    const tree = renderInTheme(
      <RouteErrorBoundary route="index" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    expect(pressables(tree).map((node) => node.props.accessibilityLabel)).toEqual([
      SCREEN_ERROR_COPY.retry,
    ]);
  });

  it("gives both controls a 44pt target", () => {
    const { Bomb } = makeBomb();
    const tree = renderInTheme(
      <RouteErrorBoundary route="events" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    for (const node of pressables(tree)) {
      const raw =
        typeof node.props.style === "function"
          ? node.props.style({ pressed: false })
          : node.props.style;
      const style = Object.assign({}, ...[raw].flat(Infinity).filter(Boolean));
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });
});

describe("the tab navigator's screen layout", () => {
  function layoutTree(params: object | undefined, Bomb: () => React.ReactElement) {
    return screenErrorLayout({
      route: { name: "event-details", params },
      children: <Bomb />,
    });
  }

  it("wraps each screen in a boundary tagged with the route", () => {
    const { Bomb } = makeBomb();
    renderInTheme(layoutTree({ id: "evt-1" }, Bomb));

    expect(captureException.mock.calls[0]?.[1]).toMatchObject({
      tags: { error_boundary: "screen", route_name: "event-details" },
    });
  });

  it("clears a fallback when the screen is opened for something else", () => {
    // Tab screens stay mounted, so a failed event must not keep its fallback
    // when the member opens a different one on the same screen.
    const { Bomb, state } = makeBomb();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>{layoutTree({ id: "evt-1" }, Bomb)}</FrappThemeProvider>,
      );
    });
    expect(texts(tree)).toContain(SCREEN_ERROR_COPY.title);

    state.fail = false;
    act(() => {
      tree.update(
        <FrappThemeProvider>{layoutTree({ id: "evt-2" }, Bomb)}</FrappThemeProvider>,
      );
    });

    expect(texts(tree)).toContain("Screen content");
  });

  it("keeps the fallback while the screen's params stay the same", () => {
    const { Bomb, state } = makeBomb();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>{layoutTree({ id: "evt-1" }, Bomb)}</FrappThemeProvider>,
      );
    });

    state.fail = false;
    act(() => {
      tree.update(
        <FrappThemeProvider>{layoutTree({ id: "evt-1" }, Bomb)}</FrappThemeProvider>,
      );
    });

    expect(texts(tree)).toContain(SCREEN_ERROR_COPY.title);
  });
});

describe("the layouts' boundary", () => {
  it("renders with no provider above it, as the root's does", () => {
    // No FrappThemeProvider here on purpose: expo-router renders the root's
    // boundary in place of the layout that mounts every provider.
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <AppErrorScreen error={new Error("provider")} retry={vi.fn()} boundary="root" />,
      );
    });

    expect(texts(tree)).toEqual(
      expect.arrayContaining([APP_ERROR_COPY.title, APP_ERROR_COPY.body]),
    );
    expect(pressables(tree).map((node) => node.props.accessibilityLabel)).toEqual([
      APP_ERROR_COPY.retry,
    ]);
  });

  it("reports once with the boundary, and Retry calls expo-router's retry", () => {
    const error = new Error("navigator");
    const retry = vi.fn().mockResolvedValue(undefined);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<AppErrorScreen error={error} retry={retry} boundary="tabs" />);
    });
    act(() => {
      tree.update(<AppErrorScreen error={error} retry={retry} boundary="tabs" />);
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { error_boundary: "tabs" },
    });

    press(tree, APP_ERROR_COPY.retry);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("the layouts mount the boundaries", () => {
  // Importing a layout runs its module scope (Sentry and PostHog init, the
  // splash hold), so these read the source. They fail if a layout loses its
  // boundary, which nothing else would notice until a screen broke.
  const app = path.resolve(__dirname, "../app");
  const source = (file: string) => readFileSync(path.join(app, file), "utf8");

  it("the root layout exports expo-router's ErrorBoundary as the root boundary", () => {
    expect(source("_layout.tsx")).toMatch(
      /export function ErrorBoundary\([^)]*\)\s*\{\s*return <AppErrorScreen \{\.\.\.props\} boundary="root" \/>;/,
    );
  });

  it("the tab layout exports one and wraps every screen in its own", () => {
    const tabs = source("(tabs)/_layout.tsx");
    expect(tabs).toMatch(
      /export function ErrorBoundary\([^)]*\)\s*\{\s*return <AppErrorScreen \{\.\.\.props\} boundary="tabs" \/>;/,
    );
    expect(tabs).toContain("screenLayout={screenErrorLayout}");
  });
});
