/** @vitest-environment jsdom */
import React, { createRef, forwardRef, useImperativeHandle } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forwardedFromOf } from "@repo/chat-core/types";
import { FrappThemeProvider } from "@/lib/theme";
import type { ForwardTarget } from "@/lib/chat/forward";

// The menu's Forward row (#4864): after Reply and Start thread, before Edit;
// drawn only where the message can be forwarded and the thread wired the
// picker; it opens the picker in place of the menu, and the menu's dismiss
// (its message was deleted) reaches the picker too. The picker itself has its
// own spec (`forward-sheet.spec.tsx`).

const picker = vi.hoisted(() => ({
  present: vi.fn(),
  dismiss: vi.fn(),
  target: undefined as unknown,
}));

vi.mock("@/components/chat/forward-sheet", () => ({
  ForwardSheet: forwardRef(function ForwardSheetStub(
    props: { target: unknown },
    ref,
  ) {
    picker.target = props.target;
    useImperativeHandle(ref, () => ({
      present: picker.present,
      dismiss: picker.dismiss,
    }));
    return null;
  }),
}));

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
    useBlockActions: () => ({ block: vi.fn(), unblock: vi.fn() }),
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
  FORWARD_LABEL,
  MessageActionsSheet,
  type MessageActionsSheetHandle,
  type MessageActionsTarget,
} from "./message-actions-sheet";

const FORWARD: ForwardTarget = {
  messageId: "m1",
  preview: forwardedFromOf({
    message_id: "m1",
    channel_id: "c1",
    sender_id: null,
    author_name: "Vic",
    content: "hi",
    created_at: "2026-11-13T18:00:00.000Z",
  })!,
  hidden: null,
};

const OWN: MessageActionsTarget = {
  messageId: "m1",
  copyText: "hi",
  canReply: true,
  canStartThread: true,
  canEdit: true,
  canDelete: true,
  canReport: false,
  blockUserId: null,
  senderName: "Vic",
  senderInDirectory: true,
  senderLabel: "You",
  sentAt: "2026-11-13T18:00:00.000Z",
  reactedWith: [],
  forward: FORWARD,
};

function render(
  target: MessageActionsTarget,
  options: {
    nameFor?: boolean;
    handle?: React.Ref<MessageActionsSheetHandle>;
  } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageActionsSheet
          ref={options.handle ?? createRef<MessageActionsSheetHandle>()}
          target={target}
          nameFor={options.nameFor === false ? undefined : () => null}
          viewerId="viewer"
          onReply={vi.fn()}
          onStartThread={vi.fn()}
          onEdit={vi.fn()}
        />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          element.type === "BottomSheetModal"
            ? { present: vi.fn(), dismiss: vi.fn() }
            : null,
      },
    );
  });
  return tree;
}

function labels(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll(
      (node) =>
        typeof node.props.accessibilityLabel === "string" &&
        typeof node.props.onPress === "function" &&
        (node.type as unknown) !== "BottomSheetModal",
    )
    .map((node) => node.props.accessibilityLabel as string)
    .filter((label, index, all) => all.indexOf(label) === index);
}

beforeEach(() => {
  picker.present.mockReset();
  picker.dismiss.mockReset();
  picker.target = undefined;
});

describe("MessageActionsSheet — Forward (#4864)", () => {
  it("sits after Reply and Start thread, before Edit, as Discord's long-press orders it", () => {
    const rows = labels(render(OWN));
    expect(rows.indexOf("Reply")).toBeLessThan(rows.indexOf("Start thread"));
    expect(rows.indexOf("Start thread")).toBeLessThan(
      rows.indexOf(FORWARD_LABEL),
    );
    expect(rows.indexOf(FORWARD_LABEL)).toBeLessThan(
      rows.indexOf("Edit message"),
    );
  });

  it("is not drawn on a message that can't be forwarded", () => {
    expect(labels(render({ ...OWN, forward: undefined }))).not.toContain(
      FORWARD_LABEL,
    );
  });

  it("is not drawn where the thread wired no picker", () => {
    expect(labels(render(OWN, { nameFor: false }))).not.toContain(
      FORWARD_LABEL,
    );
  });

  it("opens the picker on the message, in place of the menu", () => {
    const tree = render(OWN);
    expect(picker.target).toBe(FORWARD);
    const row = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === FORWARD_LABEL &&
        typeof node.props.onPress === "function",
    );
    act(() => row.props.onPress());
    expect(picker.present).toHaveBeenCalledTimes(1);
  });

  it("closes the picker too when the thread dismisses the menu (its message was deleted)", () => {
    const handle = createRef<MessageActionsSheetHandle>();
    render(OWN, { handle });
    act(() => handle.current?.dismiss());
    expect(picker.dismiss).toHaveBeenCalled();
  });
});
