/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import {
  AI_REPORT_COPY,
  AI_SUGGESTION_COPY,
  LAST_YEAR_COPY,
  aiSuggestionRefusalLine,
  lastYearEventLine,
  lastYearTaskLine,
} from "@repo/validation";
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
  canCreateEvents: true,
  readEvent: vi.fn(),
  eventForm: undefined as
    | { template?: unknown; onCreated?: (outcome: unknown) => void }
    | undefined,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  // The one read the screen makes itself: last year's event, for the form.
  useQueryClient: () => ({
    fetchQuery: (options: { queryKey: unknown }) =>
      state.readEvent(options.queryKey),
  }),
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
  useActiveChapterId: () => "chapter-1",
  useFrappClient: () => ({ GET: vi.fn() }),
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
vi.mock("@/components/events/new-event-sheet", async () => {
  const { forwardRef } = await import("react");
  return {
    useCanCreateEvents: () => state.canCreateEvents,
    NewEventSheet: forwardRef(function NewEventSheet(props: {
      template?: unknown;
      onCreated?: (outcome: unknown) => void;
    }) {
      state.eventForm = props;
      return null;
    }),
  };
});
// The template itself is `last-year-template.spec.ts`'s; here it is only
// carried from the read to the form.
vi.mock("@/lib/events/select", () => ({
  selectEventDetail: (raw: unknown) => raw,
}));
vi.mock("@/lib/events/last-year-template", () => ({
  lastYearTemplate: (event: { name: string }) => ({ name: event.name }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

const reporting = vi.hoisted(() => ({
  offered: true,
  reported: false,
  report: vi.fn(),
}));
vi.mock("@/components/ai/report-ai-sheet", () => ({
  useAiReport: () => ({
    offered: reporting.offered,
    isReported: () => reporting.reported,
    report: reporting.report,
    reportSheet: null,
  }),
}));

import SuggestedTasksScreen from "@/app/(app)/suggested-tasks";
import { suggestionEdits } from "@/lib/tasks/suggestion-edits";

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

/** An event the chapter held on April 13, 2025, and not yet this year. */
const FORMAL = {
  id: "s3",
  kind: "event",
  quote: null,
  source: { type: "event", id: "e-last" },
  task: null,
  event: { name: "Spring formal", last_year_at: "2025-04-13T12:00:00Z", times: 1 },
};
/** A task finished around now last year. */
const LAST_YEAR_TASK = {
  ...READY,
  id: "s4",
  quote: null,
  source: { type: "task", id: "t-last" },
  task: {
    ...READY.task,
    title: "Order composites",
    last_year_on: "2025-11-18",
  },
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
  state.canCreateEvents = true;
  state.eventForm = undefined;
  state.readEvent.mockResolvedValue({ name: "Spring formal" });
  state.accept.mockResolvedValue({});
  state.dismiss.mockResolvedValue({});
  reporting.offered = true;
  reporting.reported = false;
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
    expect(state.dismiss).toHaveBeenCalledWith({ id: "s1", reason: undefined });
  });

  it("reports a suggestion by its id, and offers that only to a member who can send it", () => {
    const tree = render();
    act(() =>
      byLabel(tree, `${AI_REPORT_COPY.action}: Book the hall`)!.props.onPress(),
    );
    expect(reporting.report).toHaveBeenCalledWith({
      subject: "ai_suggestion",
      subjectId: "s1",
    });
    reporting.offered = false;
    expect(
      byLabel(render(), `${AI_REPORT_COPY.action}: Book the hall`),
    ).toBeUndefined();
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

describe("This time last year", () => {
  beforeEach(() => {
    state.items = [READY, FORMAL, LAST_YEAR_TASK];
  });

  it("says what happened last year under its own heading, dates written out", () => {
    const text = screenText(render());
    expect(text).toContain(LAST_YEAR_COPY.heading);
    expect(text).toContain(LAST_YEAR_COPY.intro);
    expect(text).toContain("Spring formal");
    expect(text).toContain(lastYearEventLine("April 13, 2025", 1));
    expect(text).toContain(lastYearTaskLine("November 18, 2025"));
    // The minutes' tasks keep their own group above it.
    expect(text).toContain(AI_SUGGESTION_COPY.fromMinutesOf);
  });

  it("opens the event form on last year's event, and adds nothing until it is created", async () => {
    const tree = render();
    await act(async () =>
      byLabel(tree, `${LAST_YEAR_COPY.addEvent}: Spring formal`).props.onPress(),
    );
    expect(state.readEvent).toHaveBeenCalledWith([
      "events",
      "chapter-1",
      "e-last",
    ]);
    expect(state.eventForm?.template).toEqual({ name: "Spring formal" });
    expect(state.accept).not.toHaveBeenCalled();

    // Create in the form: the suggestion records the event it became.
    await act(async () =>
      state.eventForm!.onCreated!({ id: "e-new", name: "Spring formal" }),
    );
    expect(state.accept).toHaveBeenCalledWith({ id: "s3", eventId: "e-new" });
    expect(screenText(tree)).toContain(LAST_YEAR_COPY.eventAdded);
  });

  it("says so under the row when last year's event can't be read", async () => {
    state.readEvent.mockRejectedValue(new Error("gone"));
    const tree = render();
    await act(async () =>
      byLabel(tree, `${LAST_YEAR_COPY.addEvent}: Spring formal`).props.onPress(),
    );
    expect(state.eventForm).toBeUndefined();
    expect(screenText(tree)).toContain(LAST_YEAR_COPY.openFailed);
  });

  it("takes Already planned in one tap, for an event and for a task", async () => {
    const tree = render();
    await act(async () =>
      byLabel(
        tree,
        `${LAST_YEAR_COPY.alreadyDoing}: Spring formal`,
      ).props.onPress(),
    );
    expect(state.dismiss).toHaveBeenLastCalledWith({
      id: "s3",
      reason: "already_doing",
    });
    await act(async () =>
      byLabel(
        tree,
        `${LAST_YEAR_COPY.alreadyDoing}: Order composites`,
      ).props.onPress(),
    );
    expect(state.dismiss).toHaveBeenLastCalledWith({
      id: "s4",
      reason: "already_doing",
    });
  });

  it("dismisses with Not this year, and gives no reason", async () => {
    const tree = render();
    await act(async () =>
      byLabel(tree, `${LAST_YEAR_COPY.dismiss}: Spring formal`).props.onPress(),
    );
    expect(state.dismiss).toHaveBeenCalledWith({ id: "s3", reason: undefined });
  });

  it("offers no Add to calendar to an officer who can't create events", () => {
    state.canCreateEvents = false;
    const tree = render();
    expect(
      byLabel(tree, `${LAST_YEAR_COPY.addEvent}: Spring formal`),
    ).toBeUndefined();
    expect(
      byLabel(tree, `${LAST_YEAR_COPY.alreadyDoing}: Spring formal`),
    ).toBeDefined();
  });

  it("lists no events when opened from one meeting's minutes", () => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      meetingId: "m1",
    });
    expect(screenText(render())).not.toContain("Spring formal");
  });

  it("is the whole list when nothing from the minutes is waiting", () => {
    state.items = [FORMAL];
    const text = screenText(render());
    expect(text).toContain("Spring formal");
    expect(text).not.toContain(AI_SUGGESTION_COPY.empty);
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
