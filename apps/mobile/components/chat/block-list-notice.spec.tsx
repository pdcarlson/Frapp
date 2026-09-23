/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { AccessibilityInfo } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockListStatus } from "@repo/hooks";
import { BLOCK_LIST_WAITING_FOR_NETWORK } from "@/lib/chat/blocks";
import { FrappThemeProvider } from "@/lib/theme";
import { BlockListNotice } from "./block-list-notice";

interface NoticeProps {
  status: BlockListStatus;
  heldCount: number;
  isPaused?: boolean;
  onRetry?: () => void;
}

function element({ status, heldCount, isPaused = false, onRetry }: NoticeProps) {
  return (
    <FrappThemeProvider>
      <BlockListNotice
        status={status}
        heldCount={heldCount}
        onRetry={onRetry ?? vi.fn()}
        isRetrying={false}
        isPaused={isPaused}
      />
    </FrappThemeProvider>
  );
}

function render(props: NoticeProps): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element(props));
  });
  return tree;
}

const announce = () => vi.mocked(AccessibilityInfo.announceForAccessibility);
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
const retryButton = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === "Retry loading your block list" &&
      typeof node.props.onPress === "function",
  );

beforeEach(() => {
  announce().mockClear();
});

describe("BlockListNotice", () => {
  it("renders nothing, and says nothing, when there is nothing to report", () => {
    const tree = render({ status: "ready", heldCount: 0 });
    expect(tree.toJSON()).toBeNull();
    expect(announce()).not.toHaveBeenCalled();
  });

  it("tells VoiceOver that messages are being held, since iOS has no live regions", () => {
    render({ status: "unavailable", heldCount: 2 });
    expect(announce()).toHaveBeenCalledTimes(1);
    expect(announce()).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Couldn't load your block list\. 2 new messages are held until it loads/,
      ),
    );
  });

  it("announces again when the held count changes, and not on a re-render that says the same", () => {
    const tree = render({ status: "loading", heldCount: 1 });
    expect(announce()).toHaveBeenLastCalledWith(
      "Checking your block list. 1 new message is held until it loads.",
    );

    act(() => tree.update(element({ status: "loading", heldCount: 1 })));
    expect(announce()).toHaveBeenCalledTimes(1);

    act(() => tree.update(element({ status: "loading", heldCount: 3 })));
    expect(announce()).toHaveBeenCalledTimes(2);
    expect(announce()).toHaveBeenLastCalledWith(
      "Checking your block list. 3 new messages are held until it loads.",
    );
  });

  it("offers Retry while the read can run", () => {
    const onRetry = vi.fn();
    const tree = render({ status: "unavailable", heldCount: 0, onRetry });
    const [button] = retryButton(tree);
    act(() => button!.props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(text(tree)).not.toContain(BLOCK_LIST_WAITING_FOR_NETWORK);
  });

  it("says it retries once online instead of offering a tap that cannot help while offline", () => {
    const tree = render({ status: "unavailable", heldCount: 1, isPaused: true });
    expect(retryButton(tree)).toHaveLength(0);
    expect(text(tree)).toContain(BLOCK_LIST_WAITING_FOR_NETWORK);
  });
});
