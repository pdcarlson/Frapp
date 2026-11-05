/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

// These screens paint with the chapter accent (`useChapterBranding`), which
// reads the current chapter through the client provider these specs don't
// mount. A purple chapter's values, deliberately not house gold, so a control
// that slips back to a `gold.*` token shows up in an assertion; the hook
// itself has its own spec.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
    textMark: null,
  }),
}));
import { FrappThemeProvider } from "@/lib/theme";
import {
  HISTORY_START_COPY,
  OLDER_FAILED_COPY,
  OLDER_IDLE_COPY,
  OLDER_LOADING_COPY,
  ThreadHistoryEdge,
} from "./thread-history-edge";

/**
 * The row above the oldest loaded message in the mobile thread (#2772): the
 * older-history states the thread's scrollback moves through.
 */

interface EdgeProps {
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
  olderError?: boolean;
  onLoadOlder?: () => void;
  start?: React.ReactNode;
}

function render({
  hasOlder = true,
  isLoadingOlder = false,
  olderError = false,
  onLoadOlder = vi.fn(),
  start,
}: EdgeProps): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ThreadHistoryEdge
          hasOlder={hasOlder}
          isLoadingOlder={isLoadingOlder}
          olderError={olderError}
          onLoadOlder={onLoadOlder}
          start={start}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
const buttons = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === "button" &&
      typeof node.props.onPress === "function",
  );

describe("ThreadHistoryEdge", () => {
  it("says an older page is loading, with nothing to tap", () => {
    const tree = render({ isLoadingOlder: true, olderError: true });
    expect(text(tree)).toContain(OLDER_LOADING_COPY);
    expect(buttons(tree)).toHaveLength(0);
  });

  it("offers Retry after a failed read, and Retry loads again", () => {
    const onLoadOlder = vi.fn();
    const tree = render({ olderError: true, onLoadOlder });
    expect(text(tree)).toContain(OLDER_FAILED_COPY);
    const [retry] = buttons(tree);
    expect(retry?.props.accessibilityLabel).toBe(
      "Retry loading earlier messages",
    );
    act(() => retry!.props.onPress());
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("offers the load as a control while older history may exist", () => {
    const onLoadOlder = vi.fn();
    const tree = render({ onLoadOlder });
    expect(text(tree)).toContain(OLDER_IDLE_COPY);
    act(() => buttons(tree)[0]!.props.onPress());
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("marks the start of the history once there is nothing older", () => {
    const tree = render({ hasOlder: false });
    expect(text(tree)).toContain(HISTORY_START_COPY);
    expect(buttons(tree)).toHaveLength(0);
  });

  it("draws the channel start in place of the caption once there is nothing older", async () => {
    const { ChannelStart } = await import("./channel-start");
    const tree = render({
      hasOlder: false,
      start: (
        <ChannelStart
          type="PUBLIC"
          channelName="general"
          displayName="general"
          description="The whole chapter."
        />
      ),
    });
    const shown = text(tree);
    expect(shown).toContain("Welcome to #general");
    expect(shown).toContain("This is the start of #general.");
    expect(shown).toContain("The whole chapter.");
    expect(shown).not.toContain(HISTORY_START_COPY);
  });

  it("keeps the older-history read above the channel start while there is more", () => {
    const tree = render({ hasOlder: true, start: "CHANNEL_START_MARK" });
    expect(text(tree)).toContain(OLDER_IDLE_COPY);
    expect(text(tree)).not.toContain("CHANNEL_START_MARK");
  });
});
