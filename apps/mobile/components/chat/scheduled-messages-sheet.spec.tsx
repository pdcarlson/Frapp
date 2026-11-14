/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { ScheduledMessage } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#CB9FFF" }),
}));

const rows: { current: ScheduledMessage[] } = { current: [] };
const sendNow = vi.fn();
const remove = vi.fn();
const update = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useScheduledMessages: () => ({
    data: rows.current,
    isPending: false,
    isError: false,
  }),
  useSendScheduledMessageNow: () => ({ mutate: sendNow, isPending: false }),
  useDeleteScheduledMessage: () => ({ mutate: remove, isPending: false }),
  useUpdateScheduledMessage: () => ({ mutate: update, isPending: false }),
}));

import { ScheduledRows } from "./scheduled-messages-sheet";

function message(overrides: Partial<ScheduledMessage>): ScheduledMessage {
  const at = new Date();
  at.setDate(at.getDate() + 2);
  at.setHours(9, 0, 0, 0);
  return {
    id: "s1",
    channel_id: "c1",
    content: "Chapter is at 8",
    mention_picks: null,
    send_at: at.toISOString(),
    status: "pending",
    failure_reason: null,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
    ...overrides,
  };
}

function render(list: ScheduledMessage[]) {
  rows.current = list;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ScheduledRows channelId="c1" />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) => node.type === ("Pressable" as never) && drawnText(node) === label,
  )[0];

describe("ScheduledRows (#4956)", () => {
  it("says so when nothing is scheduled", () => {
    expect(screenText(render([]))).toContain("Nothing scheduled here.");
  });

  it("lists a pending message with when it goes, Send now and Delete", () => {
    const tree = render([message({})]);
    expect(screenText(tree)).toContain("Chapter is at 8");
    expect(screenText(tree)).toMatch(/at 9:00/);
    act(() => button(tree, "Send now")!.props.onPress());
    expect(sendNow.mock.calls[0]![0]).toBe("s1");
    act(() => button(tree, "Delete")!.props.onPress());
    expect(remove.mock.calls[0]![0]).toBe("s1");
  });

  it("says why a failed one didn't send, and offers no Send now", () => {
    const tree = render([
      message({ status: "failed", failure_reason: "no_access" }),
    ]);
    expect(screenText(tree)).toContain(
      "Not sent: you can no longer post here.",
    );
    expect(button(tree, "Send now")).toBeUndefined();
  });

  it("saves a failed one with new text and no time, so it goes at once", () => {
    update.mockClear();
    const tree = render([
      message({
        status: "failed",
        failure_reason: "send_failed",
        content: "@Jane chapter is at 8",
        mention_picks: [{ user_id: "u-jane", label: "Jane" }],
      }),
    ]);
    act(() => button(tree, "Edit")!.props.onPress());
    expect(screenText(tree)).toContain("It sends as soon as you save.");
    const input = tree.root.find(
      (node) => (node.type as unknown) === "BottomSheetTextInput",
    );
    act(() => input.props.onChangeText("@Jane chapter is at 9"));
    act(() => button(tree, "Save")!.props.onPress());
    expect(update.mock.calls[0]![0]).toEqual({
      id: "s1",
      content: "@Jane chapter is at 9",
      mentionPicks: [{ user_id: "u-jane", label: "Jane" }],
    });
  });

  it("gives a failed one a new time from the next preset", () => {
    update.mockClear();
    const tree = render([message({ status: "failed" })]);
    act(() => button(tree, "Edit")!.props.onPress());
    act(() => button(tree, "Pick a time")!.props.onPress());
    act(() => button(tree, "Save")!.props.onPress());
    const vars = update.mock.calls[0]![0];
    expect(vars.content).toBeUndefined();
    expect(vars.sendAt.getHours()).toBe(9);
    expect(vars.sendAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("leaves the time alone when only the text changed", () => {
    update.mockClear();
    const tree = render([message({})]);
    act(() => button(tree, "Edit")!.props.onPress());
    const input = tree.root.find(
      (node) => (node.type as unknown) === "BottomSheetTextInput",
    );
    act(() => input.props.onChangeText("Chapter is at 9"));
    act(() => button(tree, "Save")!.props.onPress());
    expect(update.mock.calls[0]![0].sendAt).toBeUndefined();
  });

  it("won't save an emptied message", () => {
    const tree = render([message({})]);
    act(() => button(tree, "Edit")!.props.onPress());
    const input = tree.root.find(
      (node) => (node.type as unknown) === "BottomSheetTextInput",
    );
    act(() => input.props.onChangeText("   "));
    expect(button(tree, "Save")!.props.disabled).toBe(true);
  });
});
