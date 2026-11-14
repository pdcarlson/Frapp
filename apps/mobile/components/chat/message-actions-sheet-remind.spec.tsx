/** @vitest-environment jsdom */
import React, { createRef, forwardRef, useImperativeHandle } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

// The menu's "Remind me about this" row (#4957): after Save, drawn only where
// the thread wired a reminder; it opens the time sheet in place of the menu on
// the message, and the menu's dismiss (its message was deleted) reaches that
// sheet too. The sheet itself has its own spec (`remind-sheet.spec.tsx`).

const sheet = vi.hoisted(() => ({
  present: vi.fn(),
  dismiss: vi.fn(),
  messageId: undefined as unknown,
  onRemind: undefined as unknown,
}));

vi.mock("@/components/chat/remind-sheet", () => ({
  RemindSheet: forwardRef(function RemindSheetStub(
    props: { messageId: unknown; onRemind: unknown },
    ref,
  ) {
    sheet.messageId = props.messageId;
    sheet.onRemind = props.onRemind;
    useImperativeHandle(ref, () => ({
      present: sheet.present,
      dismiss: sheet.dismiss,
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
  SAVE_LABEL,
  MessageActionsSheet,
  type MessageActionsSheetHandle,
  type MessageActionsTarget,
} from "./message-actions-sheet";
import { MESSAGE_REMINDER_LABEL } from "@repo/hooks/use-message-reminders";

const TARGET: MessageActionsTarget = {
  messageId: "m1",
  copyText: "hi",
  canReply: true,
  canEdit: false,
  canDelete: false,
  canReport: true,
  blockUserId: null,
  senderName: "Vic",
  senderInDirectory: true,
  senderLabel: "Vic",
  sentAt: "2026-11-13T18:00:00.000Z",
  reactedWith: [],
  canMention: true,
  save: { saved: false },
};

function render(
  options: {
    onRemind?: ((messageId: string, at: Date) => void) | null;
    handle?: React.Ref<MessageActionsSheetHandle>;
  } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageActionsSheet
          ref={options.handle ?? createRef<MessageActionsSheetHandle>()}
          target={TARGET}
          onReply={vi.fn()}
          onMention={vi.fn()}
          onSetSaved={vi.fn()}
          onRemind={
            options.onRemind === null
              ? undefined
              : (options.onRemind ?? vi.fn())
          }
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
  sheet.present.mockReset();
  sheet.dismiss.mockReset();
  sheet.messageId = undefined;
  sheet.onRemind = undefined;
});

describe("MessageActionsSheet — Remind me about this (#4957)", () => {
  it("sits right after Save, before Mention", () => {
    const rows = labels(render());
    expect(rows.indexOf(MESSAGE_REMINDER_LABEL)).toBe(
      rows.indexOf(SAVE_LABEL) + 1,
    );
    expect(rows.indexOf(MESSAGE_REMINDER_LABEL)).toBeLessThan(
      rows.indexOf("Mention"),
    );
  });

  it("is not drawn where the thread wired no reminder", () => {
    expect(labels(render({ onRemind: null }))).not.toContain(
      MESSAGE_REMINDER_LABEL,
    );
  });

  it("opens the time sheet on the message, in place of the menu", () => {
    const onRemind = vi.fn();
    const tree = render({ onRemind });
    expect(sheet.messageId).toBe("m1");
    expect(sheet.onRemind).toBe(onRemind);
    const row = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === MESSAGE_REMINDER_LABEL &&
        typeof node.props.onPress === "function",
    );
    act(() => row.props.onPress());
    expect(sheet.present).toHaveBeenCalledTimes(1);
  });

  it("closes the time sheet too when the thread dismisses the menu (its message was deleted)", () => {
    const handle = createRef<MessageActionsSheetHandle>();
    render({ handle });
    act(() => handle.current?.dismiss());
    expect(sheet.dismiss).toHaveBeenCalled();
  });
});
