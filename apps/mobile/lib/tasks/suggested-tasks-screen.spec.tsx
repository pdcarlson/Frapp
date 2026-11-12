/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { AI_SUGGESTION_COPY, aiSuggestionRefusalLine } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import type { ValidatedNewTask } from "@/lib/tasks/create-task";

/**
 * The officer's suggested tasks on the phone (#4313): nothing becomes a task
 * until a person accepts it, and a suggestion missing who or when is finished
 * in the normal task form first. Renders `app/(app)/suggested-tasks.tsx` but
 * lives here: a spec under `app/` ships as a route module.
 */
const state = vi.hoisted(() => ({
  items: [] as unknown[],
  isPending: false,
  isError: false,
  source: undefined as unknown,
  accept: vi.fn(),
  dismiss: vi.fn(),
  seed: undefined as unknown,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAiSuggestions: (options?: unknown) => {
    state.source = options;
    return {
      data: state.isPending ? undefined : { items: state.items, has_more: false },
      isPending: state.isPending,
      isError: state.isError,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
  useMeetings: () => ({
    data: [{ id: "m1", event_name: "Chapter meeting" }],
  }),
  useMemberDisplayNames: () => ({
    nameFor: (id: string) => (id === "u1" ? "Ana Ruiz" : null),
  }),
  useAcceptAiSuggestion: () => ({ mutateAsync: state.accept }),
  useDismissAiSuggestion: () => ({ mutateAsync: state.dismiss }),
}));
const ai = vi.hoisted(() => ({ available: true as boolean | undefined }));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ai,
}));
vi.mock("@/components/screen-shell", () => ({
  ScreenShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/pull-to-refresh", () => ({
  useRefetchAll: () => undefined,
}));
vi.mock("@/components/tasks/new-task-sheet", async () => {
  const { forwardRef } = await import("react");
  return {
    NewTaskSheet: forwardRef(function NewTaskSheet(props: {
      suggestion?: unknown;
    }) {
      state.seed = props.suggestion;
      return null;
    }),
  };
});
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

import SuggestedTasksScreen, {
  suggestionEdits,
} from "@/app/(app)/suggested-tasks";

const READY = {
  id: "s1",
  kind: "task",
  quote: "Ana will book the hall by Friday.",
  source: { type: "meeting", id: "m1" },
  task: {
    title: "Book the hall",
    assignee_id: "u1",
    due_date: "2026-11-20",
    due_at: null,
    subtasks: [],
  },
};
const UNFINISHED = {
  ...READY,
  id: "s2",
  quote: "Order shirts",
  task: { ...READY.task, title: "Order shirts", assignee_id: null },
};

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SuggestedTasksScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  )[0];

beforeEach(() => {
  vi.clearAllMocks();
  state.items = [READY, UNFINISHED];
  state.isPending = false;
  state.isError = false;
  state.seed = undefined;
  state.accept.mockResolvedValue({});
  state.dismiss.mockResolvedValue({});
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
});

describe("Suggested tasks", () => {
  it("lists each suggestion with who, when written out, and the line it came from", () => {
    const text = screenText(render());
    expect(text).toContain(AI_SUGGESTION_COPY.fromMinutesOf);
    expect(text).toContain("Chapter meeting");
    expect(text).toContain("Book the hall");
    expect(text).toContain("“Ana will book the hall by Friday.”");
    expect(text).toContain("Ana Ruiz");
    // The quote isn't repeated when it is the title.
    expect(text).not.toContain("“Order shirts”");
    expect(text).toContain(AI_SUGGESTION_COPY.who);
  });

  it("reads one meeting's suggestions when opened from its minutes", () => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      meetingId: "m1",
    });
    render();
    expect(state.source).toEqual({ source: { type: "meeting", id: "m1" } });
  });

  it("accepts a complete suggestion as it stands", async () => {
    const tree = render();
    await act(async () =>
      byLabel(tree, `${AI_SUGGESTION_COPY.accept}: Book the hall`).props.onPress(),
    );
    expect(state.accept).toHaveBeenCalledWith({ id: "s1" });
    expect(state.seed).toBeUndefined();
  });

  it("opens the task form, not a task, for one missing who or when", async () => {
    const tree = render();
    await act(async () =>
      byLabel(tree, `${AI_SUGGESTION_COPY.accept}: Order shirts`).props.onPress(),
    );
    expect(state.accept).not.toHaveBeenCalled();
    const seed = state.seed as {
      title: string;
      assigneeId: string | null;
      accept: (form: ValidatedNewTask) => Promise<void>;
    };
    expect(seed.title).toBe("Order shirts");
    expect(seed.assigneeId).toBeNull();

    // The form's Accept sends only what the officer changed.
    await seed.accept({
      title: "Order shirts",
      assignee_id: "u1",
      due_date: "2026-11-20",
      subtasks: [],
    } as unknown as ValidatedNewTask);
    expect(state.accept).toHaveBeenCalledWith({
      id: "s2",
      task: { assignee_id: "u1" },
    });
  });

  it("dismisses one", async () => {
    const tree = render();
    await act(async () =>
      byLabel(tree, `${AI_SUGGESTION_COPY.dismiss}: Book the hall`).props.onPress(),
    );
    expect(state.dismiss).toHaveBeenCalledWith("s1");
  });

  it("goes to Tasks, and asks the server nothing, where AI is off", () => {
    ai.available = false;
    state.source = "untouched";
    const tree = render();
    ai.available = true;
    expect(
      tree.root.findAll((node) => (node.type as unknown) === "Redirect")[0]
        .props.href,
    ).toBe("/tasks");
    expect(state.source).toBe("untouched");
  });

  it("names the task and why it was refused, where it outlives the row", async () => {
    state.accept.mockRejectedValue({ code: "ai.suggestion.decided" });
    const tree = render();
    await act(async () =>
      byLabel(tree, `${AI_SUGGESTION_COPY.accept}: Book the hall`).props.onPress(),
    );
    // The list reads again and drops the row, as the server no longer
    // lists it; the reason must still be on screen.
    state.items = [UNFINISHED];
    act(() => tree.update(
      <FrappThemeProvider>
        <SuggestedTasksScreen />
      </FrappThemeProvider>,
    ));
    expect(screenText(tree)).toContain(
      `“Book the hall”: ${aiSuggestionRefusalLine("ai.suggestion.decided")}`,
    );
  });

  it("says there are none, and that a read failed, in words", () => {
    state.items = [];
    expect(screenText(render())).toContain(AI_SUGGESTION_COPY.empty);

    state.isPending = false;
    state.isError = true;
    state.items = [READY];
    // A failed refresh keeps what was read.
    expect(screenText(render())).toContain("Book the hall");
  });
});

describe("suggestionEdits", () => {
  const task = {
    title: "Book the hall",
    assignee_id: "u1",
    due_date: "2026-11-20",
    due_at: null,
    subtasks: ["Call the venue"],
  };
  const form = (over: Record<string, unknown> = {}) =>
    ({
      title: task.title,
      assignee_id: task.assignee_id,
      due_date: task.due_date,
      subtasks: task.subtasks,
      ...over,
    }) as unknown as ValidatedNewTask;

  it("sends nothing when the officer changed nothing", () => {
    expect(suggestionEdits(task as never, form())).toBeUndefined();
  });

  it("sends only the fields that changed", () => {
    expect(suggestionEdits(task as never, form({ title: "Book it" }))).toEqual({
      title: "Book it",
    });
    expect(
      suggestionEdits(task as never, form({ subtasks: ["Call", "Pay"] })),
    ).toEqual({ subtasks: ["Call", "Pay"] });
  });

  it("sends the day and the time together, so a cleared time is cleared", () => {
    expect(
      suggestionEdits(
        task as never,
        form({ due_at: "2026-11-20T22:00:00.000Z" }),
      ),
    ).toEqual({ due_date: "2026-11-20", due_at: "2026-11-20T22:00:00.000Z" });
  });
});
