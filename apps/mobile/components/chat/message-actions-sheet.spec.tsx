/** @vitest-environment jsdom */
import React, { createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { AccessibilityInfo, Alert } from "react-native";
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
import { blockConfirmBody } from "@/lib/chat/block-actions";
import {
  REPORT_ALREADY_BODY,
  REPORT_FAILED_BODY,
  REPORT_FAILED_TITLE,
  REPORT_SENT_BODY,
  REPORT_SENT_TITLE,
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
  vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  report.mutateAsync.mockReset();
  blockActions.block.mockReset();
});

/** What `useReportMessage` resolves. */
function filed(alreadyReported = false) {
  return { report: { id: "r1" }, alreadyReported };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("MessageActionsSheet — menu", () => {
  it("offers Report and Block for a blockable sender", () => {
    const tree = render({
      messageId: "m1",
      blockUserId: BLOCKED,
      senderName: "Blake",
      senderInDirectory: true,
    });
    expect(text(tree)).toContain("Report message");
    expect(text(tree)).toContain("Block Blake");
  });

  it("offers Report only when the sender cannot be blocked (system actor, imported row)", () => {
    const tree = render({
      messageId: "m1",
      blockUserId: null,
      senderName: "Signet",
      senderInDirectory: false,
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
      senderInDirectory: true,
    });

    pressByLabel(tree, "Block Blake");
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    expect(title).toBe("Block Blake?");
    expect(body).toBe(blockConfirmBody(true));
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
    senderInDirectory: true,
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
    report.mutateAsync.mockResolvedValue(filed());
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
    // VoiceOver hears it too: `accessibilityLiveRegion` is Android-only.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      REPORT_SENT_TITLE,
    );
  });

  it("says it was already reported, rather than 'Report sent', when the API hands back the open report", async () => {
    report.mutateAsync.mockResolvedValue(filed(true));
    const tree = render(target);

    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    await flush();

    expect(text(tree)).toContain(REPORT_ALREADY_BODY);
    expect(text(tree)).not.toContain(REPORT_SENT_BODY);
    expect(text(tree)).not.toContain(REPORT_SENT_TITLE);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      REPORT_ALREADY_BODY,
    );
  });

  it("still reports a failure that comes back after the sheet was dismissed (finding 9)", async () => {
    const request = deferred<ReturnType<typeof filed>>();
    report.mutateAsync.mockReturnValue(request.promise);
    const tree = render(target);

    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    const reportSheet = tree.root.find(
      (node) =>
        (node.type as unknown) === "BottomSheetModal" &&
        typeof node.props.onDismiss === "function",
    );
    act(() => reportSheet.props.onDismiss());

    await act(async () => {
      request.reject(new Error("offline"));
      await Promise.resolve();
    });
    await flush();

    expect(Alert.alert).toHaveBeenCalledWith(
      REPORT_FAILED_TITLE,
      REPORT_FAILED_BODY,
    );
  });

  it("does not alert over a success that comes back after dismissal", async () => {
    const request = deferred<ReturnType<typeof filed>>();
    report.mutateAsync.mockReturnValue(request.promise);
    const tree = render(target);

    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    const reportSheet = tree.root.find(
      (node) =>
        (node.type as unknown) === "BottomSheetModal" &&
        typeof node.props.onDismiss === "function",
    );
    act(() => reportSheet.props.onDismiss());

    await act(async () => {
      request.resolve(filed());
      await Promise.resolve();
    });
    await flush();

    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("says so when the report did not send, and keeps the form", async () => {
    report.mutateAsync.mockRejectedValue(new Error("offline"));
    const tree = render(target);

    pressByLabel(tree, "Spam");
    act(() => sendButton(tree).props.onPress());
    await flush();

    expect(text(tree)).toContain(REPORT_FAILED_BODY);
    expect(text(tree)).not.toContain(REPORT_SENT_BODY);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      REPORT_FAILED_BODY,
    );
    // On screen, so no alert on top of it.
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("starts a fresh form for the next message", async () => {
    report.mutateAsync.mockResolvedValue(filed());
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
