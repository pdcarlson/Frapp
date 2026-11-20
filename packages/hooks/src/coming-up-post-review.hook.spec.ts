import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Read = { data?: unknown; isFetching?: boolean; isError?: boolean };

const reads = vi.hoisted(() => ({
  events: {} as Read,
  tasks: {} as Read,
  suggestions: {} as Read,
  roster: {} as Read & { isLoading?: boolean },
  permissions: [] as string[],
}));

vi.mock("./use-events", () => ({ useEvents: () => reads.events }));
vi.mock("./use-tasks", () => ({
  useTasks: () => reads.tasks,
  useCreateTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("./use-ai-suggestions", () => ({
  useAiSuggestions: () => reads.suggestions,
  useAcceptAiSuggestion: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("./use-members", () => ({ useChapterRoster: () => reads.roster }));
vi.mock("./use-user", () => ({
  usePermissionList: () => reads.permissions,
}));
vi.mock("./use-chapters", () => ({
  useCurrentChapter: () => ({
    data: { enabled_modules: ["events", "tasks"] },
  }),
}));

const { useComingUpPostReview } = await import("./coming-up-tracking");

const content = {
  dates: [{ date: "2099-11-21", text: "Dues due to the treasurer" }],
  action_items: [],
};

function review(enabled = true) {
  return renderHook(() => useComingUpPostReview("m-1", content, enabled)).result
    .current;
}

describe("useComingUpPostReview", () => {
  beforeEach(() => {
    reads.events = { data: [], isFetching: false };
    reads.tasks = { data: [], isFetching: false };
    reads.suggestions = { data: { items: [] }, isFetching: false };
    reads.roster = { data: [], isLoading: false };
    reads.permissions = ["tasks:manage", "members:view"];
  });

  it("offers a line once every read has answered", () => {
    expect(review()).toMatchObject([{ index: 0, kind: "task" }]);
    expect(review(false)).toBeNull();
  });

  it("waits while a read is still out", () => {
    reads.suggestions = { ...reads.suggestions, isFetching: true };
    expect(review()).toBeNull();
  });

  it("offers nothing to a poster who can't make tasks", () => {
    reads.permissions = ["members:view"];
    expect(review()).toEqual([]);
  });

  it("offers nothing when a read failed, rather than a task that may exist", () => {
    for (const failed of [
      "events",
      "tasks",
      "suggestions",
      "roster",
    ] as const) {
      reads[failed] = { ...reads[failed], isError: true };
      expect(review()).toEqual([]);
      reads[failed] = { ...reads[failed], isError: false };
    }
  });
});
