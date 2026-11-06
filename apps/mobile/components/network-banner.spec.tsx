/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetOpenChatTransportForTests,
  useReportOpenChatTransport,
} from "@repo/hooks/open-chat-transport";
import type { RealtimeTransportStatus } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

// The suite's `react-native` stub has no core `Animated`: the pill fades on
// it, so this hands it a value that never moves and a timing that finishes.
vi.mock("react-native", async () => {
  const { reactNativeStub } = await import("@/test/react-native-stub");
  return {
    ...reactNativeStub,
    Animated: {
      Value: class {
        constructor(public value: number) {}
      },
      View: "Animated.View",
      timing: () => ({
        start: (done?: (result: { finished: boolean }) => void) =>
          done?.({ finished: true }),
      }),
    },
  };
});

const connection = vi.hoisted(() => ({
  state: "ONLINE" as "ONLINE" | "DEGRADED" | "OFFLINE",
}));
vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ state: connection.state }),
}));
import { NetworkBanner } from "./network-banner";

/** Stands in for a chat thread reporting its transport. */
function OpenChat({ status }: { status: RealtimeTransportStatus }) {
  useReportOpenChatTransport(status);
  return null;
}

/** The label's pressable, not the Dismiss button's. */
function pillLabel(tree: ReactTestRenderer) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityState?.expanded !== undefined,
  );
}

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

afterEach(() => {
  act(() => resetOpenChatTransportForTests());
  connection.state = "ONLINE";
});

/*
 * 2026-11-06: a chat thread stacked this pill, a transport band under its
 * header and an offline line in the composer. One pill says it now.
 */
describe("NetworkBanner (one connection indicator)", () => {
  it("draws nothing on a healthy connection", () => {
    const tree = render(<NetworkBanner />);
    expect(tree.toJSON()).toBeNull();
  });

  it("draws the short label and names the whole sentence", () => {
    connection.state = "OFFLINE";
    const tree = render(<NetworkBanner />);
    expect(screenText(tree)).toContain("Offline");
    const label = pillLabel(tree);
    expect(label.props.accessibilityLabel).toBe(
      "You're offline. Showing cached data.",
    );
  });

  it("opens the whole sentence on a tap, with the queue promise in a chat", () => {
    connection.state = "OFFLINE";
    const tree = render(
      <>
        <OpenChat status="offline" />
        <NetworkBanner />
      </>,
    );
    act(() => pillLabel(tree).props.onPress());
    expect(tree.root.findAllByType("Text" as unknown as React.ElementType).map((t) => t.props.children)).toContain(
      "You're offline. Messages you send go out when you reconnect. Photos and files need a connection.",
    );
  });

  it("says Slow connection over a reconnecting chat, not both", () => {
    connection.state = "DEGRADED";
    const tree = render(
      <>
        <OpenChat status="reconnecting" />
        <NetworkBanner />
      </>,
    );
    expect(screenText(tree)).toContain("Slow connection");
    expect(screenText(tree)).not.toContain("Reconnecting");
  });

  it("reports a paused chat on an otherwise healthy connection", () => {
    const tree = render(
      <>
        <OpenChat status="polling" />
        <NetworkBanner />
      </>,
    );
    expect(screenText(tree)).toContain("Live updates paused");
  });
});

describe("NetworkBanner dismissal and the opened sentence", () => {
  const dismiss = (tree: ReactTestRenderer) =>
    tree.root
      .find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === "Dismiss",
      )
      .props.onPress();

  it("stays dismissed for what it said, and shows again when it says something new", () => {
    connection.state = "OFFLINE";
    const tree = render(<NetworkBanner />);
    act(() => dismiss(tree));
    expect(tree.toJSON()).toBeNull();

    // Same state, new sentence: a chat opened, so the queue's promise is news.
    act(() => {
      tree.update(
        <FrappThemeProvider>
          <OpenChat status="offline" />
          <NetworkBanner />
        </FrappThemeProvider>,
      );
    });
    expect(screenText(tree)).toContain("Offline");
  });

  it("comes back after 30s if what it says hasn't changed", () => {
    vi.useFakeTimers();
    try {
      connection.state = "DEGRADED";
      const tree = render(<NetworkBanner />);
      act(() => dismiss(tree));
      expect(tree.toJSON()).toBeNull();
      act(() => vi.advanceTimersByTime(30_000));
      expect(screenText(tree)).toContain("Slow connection");
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the opened sentence on a second tap", () => {
    connection.state = "DEGRADED";
    const tree = render(<NetworkBanner />);
    act(() => pillLabel(tree).props.onPress());
    expect(screenText(tree)).toContain("Some features may be delayed.");
    act(() => pillLabel(tree).props.onPress());
    expect(screenText(tree)).not.toContain("Some features may be delayed.");
  });
});
