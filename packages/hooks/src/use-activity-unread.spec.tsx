import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { activityGroups, type Activity } from "./activity-rows";
import { activityKeys } from "./use-activity";
import {
  markActivityItemsRead,
  useActivityUnread,
} from "./use-activity-unread";
import { FrappClientProvider } from "./use-frapp-client";

const KEY = activityKeys.chapter("chapter-1");

const task = (id: string, unread: boolean) => ({
  id,
  title: `Task ${id}`,
  due_date: "2099-01-01",
  status: "TODO",
  stored_status: "TODO",
  assignee_id: "me",
  assignee_name: "Me",
  created_by: "officer",
  created_by_name: "Olive",
  point_reward: null,
  completed_at: null,
  confirmed_at: null,
  created_at: "2026-11-01T00:00:00.000Z",
  unread,
});
const poll = (id: string, unread: boolean) => ({
  message_id: id,
  channel_id: "c1",
  channel_name: "general",
  channel_type: "PUBLIC",
  sender_id: "officer",
  question: `Poll ${id}`,
  option_count: 2,
  closes_at: "2099-01-01T00:00:00.000Z",
  closed_at: null,
  is_closed: false,
  has_voted: false,
  created_at: "2026-11-01T00:00:00.000Z",
  message: {},
  unread,
});
const event = (id: string, unread: boolean) => ({
  id,
  name: `Event ${id}`,
  location: null,
  start_time: "2099-01-01T19:00:00.000Z",
  end_time: "2099-01-01T20:00:00.000Z",
  attendance: "optional",
  point_value: 0,
  check_in_opens_minutes: 10,
  check_in_open: false,
  checked_in: null,
  created_by: "officer",
  unread,
});
const link = (id: string, unread: boolean) => ({
  id,
  url: `https://forms.gle/${id}`,
  host: "forms.gle",
  title: null,
  message_id: `m-${id}`,
  thread_root_id: null,
  channel_id: "c1",
  channel_name: "rush",
  channel_type: "PUBLIC",
  posted_by: "olive",
  posted_by_name: "Olive",
  posted_at: "2026-11-10T15:00:00.000Z",
  unread,
});
const hours = (id: string, unread: boolean) => ({
  id,
  member_id: "m1",
  member_name: "Sam",
  description: "Food bank",
  duration_minutes: 60,
  created_at: "2026-11-01T00:00:00.000Z",
  unread,
});

const read = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    needs_you: {
      tasks: [task("t1", true)],
      task_confirmations: [task("t2", true)],
      hours_approvals: [hours("h1", true)],
      polls: [poll("p1", true)],
    },
    coming_up: [event("e1", true)],
    links: [link("l1", true)],
    made_by_you: {
      polls: [poll("p9", true)],
      tasks: [task("t9", true)],
      events: [event("e9", true)],
    },
    needs_you_count: 4,
    unavailable: [],
    unread_since: "2026-11-01T00:00:00.000Z",
    ...overrides,
  }) as unknown as Activity;

const unreadKeys = (data: Activity) =>
  activityGroups(data, "all", new Date("2026-11-12T00:00:00.000Z"))
    .flatMap((group) => group.rows)
    .filter((row) => row.unread)
    .map((row) => row.key);

describe("Activity rows' unread (#4402)", () => {
  it("dots the rows the read serves unread, never one under Made by you", () => {
    expect(unreadKeys(read()).sort()).toEqual(
      [
        "coming:event:e1",
        "link:l1",
        "needs-confirm:task:t2",
        "needs:hours:h1",
        "needs:poll:p1",
        "needs:task:t1",
      ].sort(),
    );
  });

  it("names each row's item the way the reads route takes it", () => {
    const rows = activityGroups(
      read(),
      "all",
      new Date("2026-11-12T00:00:00.000Z"),
    ).flatMap((group) => group.rows);
    const refOf = (key: string) => rows.find((row) => row.key === key)?.readRef;
    expect(refOf("needs:poll:p1")).toEqual({ kind: "poll", item_id: "p1" });
    expect(refOf("needs:hours:h1")).toEqual({
      kind: "hours_entry",
      item_id: "h1",
    });
    expect(refOf("needs-confirm:task:t2")).toEqual({
      kind: "task",
      item_id: "t2",
    });
    expect(refOf("coming:event:e1")).toEqual({ kind: "event", item_id: "e1" });
    expect(refOf("link:l1")).toEqual({ kind: "link", item_id: "l1" });
  });
});

describe("markActivityItemsRead", () => {
  it("clears only the named items, a task in both of its lists", () => {
    const data = read({
      needs_you: {
        tasks: [task("t1", true)],
        task_confirmations: [task("t1", true), task("t2", true)],
        hours_approvals: [],
        polls: [poll("p1", true)],
      },
    });
    const next = markActivityItemsRead(data, [
      { kind: "task", item_id: "t1" },
      { kind: "poll", item_id: "p1" },
    ]);
    expect(next.needs_you.tasks[0]!.unread).toBe(false);
    expect(next.needs_you.task_confirmations.map((t) => t.unread)).toEqual([
      false,
      true,
    ]);
    expect(next.needs_you.polls[0]!.unread).toBe(false);
    expect(next.links[0]!.unread).toBe(true);
  });

  it("returns the same read when nothing it names was unread", () => {
    const data = read();
    expect(
      markActivityItemsRead(data, [{ kind: "link", item_id: "nope" }]),
    ).toBe(data);
  });
});

function setup(data: Activity) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(KEY, data);
  const PUT = vi.fn(async () => ({}));
  const POST = vi.fn(async () => ({}));
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        { PUT, POST } as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
      chapterId="chapter-1"
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  return { queryClient, PUT, POST, wrapper };
}

describe("useActivityUnread", () => {
  it("starts the member's dots once when the read serves none yet", async () => {
    const data = read({ unread_since: null });
    const { PUT, wrapper } = setup(data);
    const { rerender } = renderHook(() => useActivityUnread(data), {
      wrapper,
    });
    rerender();
    await waitFor(() => expect(PUT).toHaveBeenCalledTimes(1));
    expect(PUT).toHaveBeenCalledWith("/v1/activity/unread-since");
  });

  it("doesn't start them again once they have begun", () => {
    const data = read();
    const { PUT, wrapper } = setup(data);
    renderHook(() => useActivityUnread(data), { wrapper });
    expect(PUT).not.toHaveBeenCalled();
  });

  it("clears an opened row's dot at once and records the open", async () => {
    const data = read();
    const { queryClient, POST, wrapper } = setup(data);
    const { result } = renderHook(() => useActivityUnread(data), { wrapper });
    act(() => result.current.markRead([{ kind: "link", item_id: "l1" }]));
    await waitFor(() =>
      expect(queryClient.getQueryData<Activity>(KEY)?.links[0]!.unread).toBe(
        false,
      ),
    );
    await waitFor(() =>
      expect(POST).toHaveBeenCalledWith("/v1/activity/reads", {
        body: { items: [{ kind: "link", item_id: "l1" }] },
      }),
    );
  });
});
