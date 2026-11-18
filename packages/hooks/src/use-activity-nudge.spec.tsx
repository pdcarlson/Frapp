import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useActivityNudgeActions,
  type ActivityNudge,
} from "./use-activity-nudge";
import { createHookWrapper, createTestQueryClient } from "./test-utils";

const CHAPTER_ID = "chapter-abc";
const KEY = ["activity-nudge", CHAPTER_ID];

function item(
  subject: string,
  overrides: Partial<ActivityNudge> = {},
): ActivityNudge {
  return {
    id: null,
    kind: "event_soon",
    subject_key: subject,
    headline: subject,
    meta: "Tonight",
    urgent: false,
    chip: "Tonight",
    action: "Open event",
    target_type: "event",
    target_id: subject,
    channel_id: null,
    task_id: null,
    line: null,
    start_here: null,
    seen: false,
    ...overrides,
  };
}

function setup(result: { error?: unknown }) {
  const POST = vi.fn(() => Promise.resolve({ data: undefined, ...result }));
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(KEY, {
    card: item("a", { id: "row-a" }),
    tray: [item("b"), item("c")],
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const hook = renderHook(() => useActivityNudgeActions(), {
    wrapper: createHookWrapper({
      client: { POST },
      queryClient,
      chapterId: CHAPTER_ID,
      displayName: "ActivityNudgeWrapper",
    }),
  });
  return { hook, queryClient, invalidate, POST };
}

describe("useActivityNudgeActions", () => {
  it("waving off the card moves the tray's first up, then asks again", async () => {
    const { hook, queryClient, invalidate, POST } = setup({});
    act(() => hook.result.current.dismiss(item("a")));
    expect(queryClient.getQueryData(KEY)).toEqual({
      card: item("b"),
      tray: [item("c")],
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(POST).toHaveBeenCalledWith("/v1/activity/card/dismiss", {
      body: { kind: "event_soon", subject_key: "a" },
    });
  });

  it("waving off a tray item takes only it out", () => {
    const { hook, queryClient } = setup({});
    act(() => hook.result.current.dismiss(item("c")));
    expect(queryClient.getQueryData(KEY)).toEqual({
      card: item("a", { id: "row-a" }),
      tray: [item("b")],
    });
  });

  it("leaves the card off, and doesn't ask again, when the server refused", async () => {
    const { hook, queryClient, invalidate, POST } = setup({
      error: { message: "nope" },
    });
    act(() => hook.result.current.dismiss(item("a")));
    await waitFor(() => expect(POST).toHaveBeenCalled());
    // Give the mutation a beat to settle.
    await act(async () => {
      await Promise.resolve();
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(
      (queryClient.getQueryData(KEY) as { card: ActivityNudge }).card
        .subject_key,
    ).toBe("b");
  });

  it("marks only the showing card seen", () => {
    const { hook, queryClient } = setup({});
    act(() => hook.result.current.markSeen("row-a"));
    const data = queryClient.getQueryData(KEY) as {
      card: ActivityNudge;
      tray: ActivityNudge[];
    };
    expect(data.card.seen).toBe(true);
    expect(data.tray.every((t) => !t.seen)).toBe(true);
  });
});
