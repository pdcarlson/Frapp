/** @vitest-environment jsdom */
import React, { createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

// The long-press sheet's Flag row (#3921). Beside the sheet's main suite
// rather than in it, so the two change apart.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useReportMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock("@/lib/chat/block-actions", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/chat/block-actions")
  >("@/lib/chat/block-actions");
  return {
    ...actual,
    useBlockActions: () => ({
      block: vi.fn(),
      unblock: vi.fn(),
      isPending: false,
    }),
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

import {
  MessageActionsSheet,
  type MessageActionsSheetHandle,
  type MessageActionsTarget,
} from "./message-actions-sheet";

const BASE: MessageActionsTarget = {
  messageId: "m1",
  copyText: null,
  canReply: false,
  canEdit: false,
  canDelete: false,
  canReport: true,
  blockUserId: null,
  senderName: "Elias",
  senderInDirectory: true,
  senderLabel: "Elias",
  sentAt: "2026-11-11T13:46:00.000Z",
  reactedWith: [],
};

function render(
  target: MessageActionsTarget,
  onFlag?: (messageId: string, flag: string | null) => void,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageActionsSheet
          ref={createRef<MessageActionsSheetHandle>()}
          target={target}
          onFlag={onFlag}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const flagChips = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      String(node.props.testID ?? "").startsWith("message-flag-") &&
      typeof node.props.onPress === "function",
    { deep: false },
  );

describe("MessageActionsSheet — Flag (#3921)", () => {
  it("offers every flag, Important first, and flags the message", () => {
    const onFlag = vi.fn();
    const tree = render({ ...BASE, flag: { current: null } }, onFlag);
    const chips = flagChips(tree);
    expect(chips.map((chip) => chip.props.accessibilityLabel)).toEqual([
      "Important",
      "Funny",
      "Interesting",
      "Question",
      "Hype",
      "FYI",
    ]);

    act(() => chips[0]!.props.onPress());

    expect(onFlag).toHaveBeenCalledWith("m1", "important");
  });

  it("draws the current flag selected and takes it off on a second tap", () => {
    const onFlag = vi.fn();
    const tree = render({ ...BASE, flag: { current: "funny" } }, onFlag);
    const funny = flagChips(tree).find(
      (chip) => chip.props.accessibilityLabel === "Funny",
    )!;
    expect(funny.props.accessibilityState).toEqual({ checked: true });

    act(() => funny.props.onPress());

    expect(onFlag).toHaveBeenCalledWith("m1", null);
  });

  it("draws no Flag row where the viewer may not flag, or with no handler", () => {
    expect(flagChips(render(BASE, vi.fn()))).toHaveLength(0);
    expect(
      flagChips(render({ ...BASE, flag: { current: null } })),
    ).toHaveLength(0);
  });
});
