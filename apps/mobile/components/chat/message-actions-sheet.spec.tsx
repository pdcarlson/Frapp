/** @vitest-environment jsdom */
import React, { createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { Alert } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

// The report settles in a microtask after the press, so its state update lands
// inside an async `act`; React only accepts that when told this is a test env.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const report = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));
const blockActions = vi.hoisted(() => ({
  block: vi.fn(),
  unblock: vi.fn(),
  isPending: false,
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return { ...actual, useReportMessage: () => report };
});

vi.mock("@/lib/chat/block-actions", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/chat/block-actions")
  >("@/lib/chat/block-actions");
  return { ...actual, useBlockActions: () => blockActions };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentFallbackApplied: false,
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    logoUrl: null,
    chapterName: null,
  }),
}));

import {
  MessageActionsSheet,
  type MessageActionsSheetHandle,
  type MessageActionsTarget,
} from "./message-actions-sheet";
import {
  REPORT_FAILED_BODY,
  REPORT_SENT_BODY,
} from "@/lib/chat/report-reasons";

const BLOCKED = "22222222-2222-4222-8222-222222222222";

function render(target: MessageActionsTarget | null): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageActionsSheet
          ref={createRef<MessageActionsSheetHandle>()}
          target={target}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function text(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function pressByLabel(tree: ReactTestRenderer, label: string) {
  const node = tree.root.find(
    (candidate) =>
      candidate.props.accessibilityLabel === label &&
      typeof candidate.props.onPress === "function",
  );
  act(() => node.props.onPress());
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.mocked(Alert.alert).mockClear();
  report.mutateAsync.mockReset();
  blockActions.block.mockReset();
});

describe("MessageActionsSheet — menu", () => {
  it("offers Report and Block for a blockable sender", () => {
    const tree = render({
      messageId: "m1",
      blockUserId: BLOCKED,
      senderName: "Blake",
    });
    expect(text(tree)).toContain("Report message");
    expect(text(tree)).toContain("Block Blake");
  });

  it("offers Report only when the sender cannot be blocked (system actor, imported row)", () => {
    const tree = render({
      messageId: "m1",
      blockUserId: null,
      senderName: "Signet",
    });
    expect(text(tree)).toContain("Report message");
    expect(text(tree)).not.toContain("Block Signet");
  });

  it("confirms before blocking, and blocks only on the destructive choice", async () => {
    blockActions.block.mockResolvedValue(undefined);
    const tree = render({
      messageId: "m1",
      blockUserId: BLOCKED,
      senderName: "Blake",
    });

    pressByLabel(tree, "Block Blake");
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    expect(title).toBe("Block Blake?");
    expect(body).toMatch(/won't be told/);
    expect(blockActions.block).not.toHaveBeenCalled();

    const confirm = buttons!.find((button) => button.style === "destructive");
    act(() => confirm!.onPress!());
    await flush();
    expect(blockActions.block).toHaveBeenCalledWith(BLOCKED);
  });
});

describe("MessageActionsSheet — report", () => {
  const target: MessageActionsTarget = {
    messageId: "m1",
    blockUserId: BLOCKED,
    senderName: "Blake",
  };

  function sendButton(tree: ReactTestRenderer) {
    return tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.findAll(
          (child) =>
            (child.type as unknown) === "Text" &&
            child.props.children === "Send report",
        ).length > 0,
    );
  }

  it("cannot send until a reason is picked", () => {
    const tree = render(target);
    expect(sendButton(tree).props.disabled).toBe(true);
  });

  it("files the chosen reason and details against the message", async () => {
    report.mutateAsync.mockResolvedValue({ id: "r1" });
    const tree = render(target);

    pressByLabel(tree, "Harassment or bullying");
    const input = tree.root.find(
      (node) => node.props.accessibilityLabel === "Details, optional",
    );
    act(() => input.props.onChangeText("keeps DMing me"));
    act(() => sendButton(tree).props.onPress());
    await flush();

    expect(report.mutateAsync).toHaveBeenCalledWith({
      messageId: "m1",
      reason: "harassment",
      details: "keeps DMing me",
    });
    expect(text(tree)).toContain(REPORT_SENT_BODY);
    // Promises neither a reviewer nor a response time.
    expect(REPORT_SENT_BODY).not.toMatch(/within|hours|days|respond/i);
  });

  it("says so when the report did not send, and keeps the form", async () => {
    report.mutateAsync.mockRejectedValue(new Error("offline"));
    const tree = render(target);

    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    await flush();

    expect(text(tree)).toContain(REPORT_FAILED_BODY);
    expect(text(tree)).not.toContain(REPORT_SENT_BODY);
  });

  it("starts a fresh form for the next message", async () => {
    report.mutateAsync.mockResolvedValue({ id: "r1" });
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MessageActionsSheet target={target} />
        </FrappThemeProvider>,
      );
    });
    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    await flush();
    expect(text(tree)).toContain(REPORT_SENT_BODY);

    act(() => {
      tree.update(
        <FrappThemeProvider>
          <MessageActionsSheet target={{ ...target, messageId: "m2" }} />
        </FrappThemeProvider>,
      );
    });
    expect(text(tree)).not.toContain(REPORT_SENT_BODY);
    expect(sendButton(tree).props.disabled).toBe(true);
  });
});
