/** @vitest-environment jsdom */
import React, { act } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import * as Sentry from "@sentry/react-native";
import { usePathname, useRouter } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

// `state-block` and the back row read chapter branding, which would drag the
// API client into a spec about error boundaries (see state-block.spec.tsx).
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
 * and route on it, when a screen's boundary tries again, and that the layouts
 * actually mount the boundaries.
 */

const captureException = vi.mocked(Sentry.captureException);
const BACK_LABEL = "Back to Chat";

/** A child that throws while `state.fail` is set, and renders text otherwise. */
function makeBomb(...thrown: [unknown?]) {
  // A rest parameter, not a default, so `makeBomb(undefined)` throws undefined.
  const error = thrown.length > 0 ? thrown[0] : new Error("Cannot read properties of undefined");
  const state = { fail: true, error, fresh: false };
  function Bomb() {
    // `fresh` throws a new object each render, as most real render errors do.
    if (state.fail) throw state.fresh ? new Error("fresh") : state.error;
    return <Text>Screen content</Text>;
  }
  return { Bomb, state };
}

/** A stand-in for a screen's navigation object, with its focus events. */
function fakeNavigation() {
  const listeners = { focus: new Set<() => void>(), blur: new Set<() => void>() };
  return {
    addListener: (event: "focus" | "blur", callback: () => void) => {
      listeners[event].add(callback);
      return () => {
        listeners[event].delete(callback);
      };
    },
    emit: (event: "focus" | "blur") => {
      act(() => {
        for (const callback of listeners[event]) callback();
      });
    },
    listenerCount: () => listeners.focus.size + listeners.blur.size,
  };
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType("Text" as unknown as React.ComponentType)
    .flatMap((node) =>
      node.children.filter((child): child is string => typeof child === "string"),
    );
}

function buttonLabels(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType("Pressable" as unknown as React.ComponentType)
    .map((node) => node.props.accessibilityLabel as string);
}

function press(tree: ReactTestRenderer, label: string) {
  const button = tree.root
    .findAllByType("Pressable" as unknown as React.ComponentType)
    .find((node) => node.props.accessibilityLabel === label);
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

function update(tree: ReactTestRenderer, node: React.ReactElement) {
  act(() => {
    tree.update(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
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

  it("reports to Sentry with the boundary and the route as a path", () => {
    const error = new Error("boom");
    const { Bomb } = makeBomb(error);
    renderInTheme(
      <RouteErrorBoundary route="event-details" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { error_boundary: "screen", route_path: "/event-details" },
    });
  });

  it("names Chat home by the path usePathname gives it", () => {
    const { Bomb } = makeBomb();
    renderInTheme(
      <RouteErrorBoundary route="index" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    expect(captureException.mock.calls[0]?.[1]).toEqual({
      tags: { error_boundary: "screen", route_path: "/" },
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

  it("puts one button on the card, and the way back on a back row above it", () => {
    // components.md §10: the Error card carries one button. A second action
    // beside it is the defect.
    const { Bomb } = makeBomb();
    const tree = renderInTheme(
      <RouteErrorBoundary route="chat-thread" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    expect(buttonLabels(tree)).toEqual([BACK_LABEL, SCREEN_ERROR_COPY.retry]);
    press(tree, BACK_LABEL);
    expect(vi.mocked(useRouter)().navigate).toHaveBeenCalledWith("/");
  });

  it("draws no back row on Chat home, which is where it leads", () => {
    const { Bomb } = makeBomb();
    const tree = renderInTheme(
      <RouteErrorBoundary route="index" resetKey="null">
        <Bomb />
      </RouteErrorBoundary>,
    );

    expect(buttonLabels(tree)).toEqual([SCREEN_ERROR_COPY.retry]);
  });
});

describe("when a screen's boundary tries again", () => {
  function layout(
    params: object | undefined,
    Bomb: () => React.ReactElement,
    navigation = fakeNavigation(),
  ) {
    return screenErrorLayout({
      route: { name: "event-details", params },
      navigation,
      children: <Bomb />,
    });
  }

  it("clears a fallback when the screen is opened for something else", () => {
    // Tab screens stay mounted, so a failed event must not keep its fallback
    // when the member opens a different one on the same screen.
    const { Bomb, state } = makeBomb();
    const navigation = fakeNavigation();
    const tree = renderInTheme(layout({ id: "evt-1" }, Bomb, navigation));
    expect(texts(tree)).toContain(SCREEN_ERROR_COPY.title);

    state.fail = false;
    update(tree, layout({ id: "evt-2" }, Bomb, navigation));

    expect(texts(tree)).toContain("Screen content");
  });

  it("keeps the fallback while the screen's params stay the same", () => {
    const { Bomb, state } = makeBomb();
    const navigation = fakeNavigation();
    const tree = renderInTheme(layout({ id: "evt-1" }, Bomb, navigation));

    state.fail = false;
    update(tree, layout({ id: "evt-1" }, Bomb, navigation));

    expect(texts(tree)).toContain(SCREEN_ERROR_COPY.title);
  });

  it("keeps the fallback, and reports once, when the new params are what broke it", () => {
    // The commit that catches the error is also the one with the new key, and
    // resetting there would render the failing screen straight back.
    const { Bomb, state } = makeBomb();
    state.fail = false;
    state.fresh = true;
    const navigation = fakeNavigation();
    const tree = renderInTheme(layout({ id: "evt-1" }, Bomb, navigation));
    expect(texts(tree)).toContain("Screen content");

    state.fail = true;
    update(tree, layout({ id: "evt-2" }, Bomb, navigation));

    expect(texts(tree)).toContain(SCREEN_ERROR_COPY.title);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("tries the screen again when the member comes back to it", () => {
    const { Bomb, state } = makeBomb();
    const navigation = fakeNavigation();
    const tree = renderInTheme(layout({ id: "evt-1" }, Bomb, navigation));

    state.fail = false;
    navigation.emit("blur");
    navigation.emit("focus");

    expect(texts(tree)).toContain("Screen content");
  });

  it("doesn't retry on a focus that wasn't a return", () => {
    // The screen can fail while it is being focused; that focus is not the
    // member coming back.
    const { Bomb, state } = makeBomb();
    const navigation = fakeNavigation();
    const tree = renderInTheme(layout({ id: "evt-1" }, Bomb, navigation));

    state.fail = false;
    navigation.emit("focus");

    expect(texts(tree)).toContain(SCREEN_ERROR_COPY.title);
  });

  it("stops listening when the screen unmounts", () => {
    const { Bomb } = makeBomb();
    const navigation = fakeNavigation();
    const tree = renderInTheme(layout({ id: "evt-1" }, Bomb, navigation));
    expect(navigation.listenerCount()).toBe(2);

    act(() => tree.unmount());

    expect(navigation.listenerCount()).toBe(0);
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
    expect(buttonLabels(tree)).toEqual([APP_ERROR_COPY.retry]);
  });

  it("reports once with the boundary and the path, and Retry calls expo-router's retry", () => {
    vi.mocked(usePathname).mockReturnValue("/sign-in");
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
      tags: { error_boundary: "tabs", route_path: "/sign-in" },
    });

    press(tree, APP_ERROR_COPY.retry);
    expect(retry).toHaveBeenCalledTimes(1);
    vi.mocked(usePathname).mockReturnValue("/");
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
      /^export function ErrorBoundary\([^)]*\)\s*\{\s*return <AppErrorScreen \{\.\.\.props\} boundary="root" \/>;/m,
    );
  });

  it("the tab layout exports one and wraps every screen in its own", () => {
    const tabs = source("(tabs)/_layout.tsx");
    expect(tabs).toMatch(
      /^export function ErrorBoundary\([^)]*\)\s*\{\s*return <AppErrorScreen \{\.\.\.props\} boundary="tabs" \/>;/m,
    );
    // Anchored to a line of its own, so a commented-out prop fails here.
    expect(tabs).toMatch(/^\s*screenLayout=\{screenErrorLayout\}\s*$/m);
  });
});
