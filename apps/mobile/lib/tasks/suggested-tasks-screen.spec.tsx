/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import {
  AI_SUGGESTION_COPY,
  LAST_YEAR_COPY,
  SIMILAR_TASK_COPY,
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
  tasks: [] as unknown[],
  isPending: false,
  isError: false,
  source: undefined as unknown,
  accept: vi.fn(),
  dismiss: vi.fn(),
  toNextAgenda: vi.fn(),
  undoNextAgenda: vi.fn(),
  eventsOn: true,
  seed: undefined as unknown,
  canCreateEvents: true,
  readEvent: vi.fn(),
  eventForm: undefined as
    { template?: unknown; onCreated?: (outcome: unknown) => void } | undefined,
  /** The ⋯ menu last opened. */
  menu: undefined as
    { title: string; actions: { key: string; run: () => void }[] } | undefined,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  // The one read the screen makes itself: last year's event, for the form.
  useQueryClient: () => ({
    fetchQuery: (options: { queryKey: unknown }) =>
      state.readEvent(options.queryKey),
  }),
}));
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  const { useState } = await import("react");
  const { similarTask } = await import("@repo/validation");
  return {
    ...actual,
    useAiSuggestions: (options?: unknown) => {
      state.source = options;
      return {
        data: state.isPending
          ? undefined
          : { items: state.items, has_more: false },
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
    // The chapter's open tasks, to spot a suggestion that is one of them
    // (#5562): the hook's own reading of `state.tasks`, without the read.
    useSimilarTasks: (items: { id: string; task: { title: string } }[]) => {
      const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
      const existing = actual.readExistingTasks(state.tasks);
      return {
        twinOf: (id: string) => {
          const item = items.find((row) => row.id === id);
          return !item || kept.has(id)
            ? null
            : similarTask(item.task.title, existing);
        },
        keep: (id: string) => setKept((previous) => new Set(previous).add(id)),
        known: true,
      };
    },
    useActiveChapterId: () => "chapter-1",
    useFrappClient: () => ({ GET: vi.fn() }),
    useAcceptAiSuggestion: () => ({ mutateAsync: state.accept }),
    useDismissAiSuggestion: () => ({ mutateAsync: state.dismiss }),
    useSendAiSuggestionToNextAgenda: () => ({
      mutateAsync: state.toNextAgenda,
    }),
    useUndoAiSuggestionNextAgenda: () => ({
      mutateAsync: state.undoNextAgenda,
    }),
    useCurrentChapter: () => ({
      data: { enabled_modules: state.eventsOn ? {} : { events: false } },
    }),
  };
});
const ai = vi.hoisted(() => ({ available: true as boolean | undefined }));
// The chapter as the Assign to picker reads it (`use-who-directory.ts`).
vi.mock("@/lib/tasks/use-who-directory", async () => {
  const { buildWhoDirectory } = await import("@repo/hooks/task-who-picker");
  const directory = buildWhoDirectory({
    members: [
      { user_id: "user-1", display_name: "Paul Carlson", role_ids: [] },
      { user_id: "user-2", display_name: "Shawn Klein", role_ids: [] },
    ],
    viewerUserId: "user-1",
  });
  return {
    useWhoDirectory: () => ({
      directory,
      people: "ready",
      sets: "ready",
      followers: [],
    }),
  };
});

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
vi.mock("@/components/item-actions-menu", () => ({
  useItemMenu: () => ({
    handleFor: (menu: NonNullable<typeof state.menu>) =>
      menu.actions.length === 0
        ? null
        : {
            ...menu,
            open: () => {
              state.menu = menu;
            },
          },
    element: null,
  }),
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
  event: {
    name: "Spring formal",
    last_year_at: "2025-04-13T12:00:00Z",
    times: 1,
  },
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

/** Steps the card forward, as "Next suggestion" does. */
function next(tree: ReactTestRenderer) {
  act(() => byLabel(tree, AI_SUGGESTION_COPY.next)!.props.onPress());
}

type OpenedMenu = {
  title: string;
  actions: { key: string; run: () => void }[];
};

/** Opens a card's ⋯ and names what it holds, by key. */
function menuOf(tree: ReactTestRenderer, title: string) {
  state.menu = undefined;
  act(() =>
    byLabel(tree, `${AI_SUGGESTION_COPY.more}: ${title}`)!.props.onPress({
      nativeEvent: { pageY: 0 },
    }),
  );
  // Set by the press above, which TypeScript can't see.
  const opened = state.menu as OpenedMenu | undefined;
  return opened?.actions ?? [];
}
const menuAction = (tree: ReactTestRenderer, title: string, key: string) =>
  menuOf(tree, title).find((action) => action.key === key);

beforeEach(() => {
  vi.clearAllMocks();
  state.items = [READY, UNFINISHED];
  state.tasks = [];
  state.eventsOn = true;
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
  it("shows one suggestion at a time with who, when, and the line it came from", () => {
    const tree = render();
    let text = screenText(tree);
    expect(text).toContain(AI_SUGGESTION_COPY.position(1, 2));
    expect(text).toContain(AI_SUGGESTION_COPY.fromMinutesOf);
    expect(text).toContain("Chapter meeting");
    expect(text).toContain("Book the hall");
    expect(text).toContain("“Ana will book the hall by Friday.”");
    expect(text).toContain("Ana Ruiz");
    // The next one waits its turn (Paul, 2026-11-19: "one at a time").
    expect(text).not.toContain("Order shirts");
    expect(byLabel(tree, AI_SUGGESTION_COPY.previous)!.props.disabled).toBe(
      true,
    );

    next(tree);
    text = screenText(tree);
    expect(text).toContain(AI_SUGGESTION_COPY.position(2, 2));
    expect(text).toContain("Order shirts");
    // The quote isn't repeated when it is the title.
    expect(text).not.toContain("“Order shirts”");
    expect(text).toContain(AI_SUGGESTION_COPY.who);
    expect(byLabel(tree, AI_SUGGESTION_COPY.next)!.props.disabled).toBe(true);
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
      byLabel(
        tree,
        `${AI_SUGGESTION_COPY.accept}: Book the hall`,
      ).props.onPress(),
    );
    expect(state.accept).toHaveBeenCalledWith({ id: "s1" });
    expect(state.seed).toBeUndefined();
  });

  it("shows who and when as chips that open the form, and asks Who? where nobody is named", () => {
    const tree = render();
    next(tree);
    const whoChip = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.startsWith("Assignee for Order shirts"),
    )[0]!;
    expect(whoChip.props.accessibilityLabel).toBe(
      `Assignee for Order shirts: ${AI_SUGGESTION_COPY.who}`,
    );
    act(() => whoChip.props.onPress());
    expect((state.seed as { title: string }).title).toBe("Order shirts");
    // The due chip writes the day out, as web's does.
    act(() => byLabel(tree, AI_SUGGESTION_COPY.previous)!.props.onPress());
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          typeof node.props.accessibilityLabel === "string" &&
          node.props.accessibilityLabel.startsWith(
            "Due date for Book the hall: ",
          ),
      ),
    ).toHaveLength(1);
    expect(screenText(tree)).not.toContain(AI_SUGGESTION_COPY.when);
  });

  it("brings the next suggestion into the place of one decided, even the last", () => {
    const tree = render();
    next(tree);
    expect(screenText(tree)).toContain(AI_SUGGESTION_COPY.position(2, 2));
    // The second is decided and the list reads again without it.
    state.items = [READY];
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <SuggestedTasksScreen />
        </FrappThemeProvider>,
      ),
    );
    expect(screenText(tree)).toContain("Book the hall");
  });

  it("asks When? on a suggestion the minutes gave no day", () => {
    state.items = [{ ...READY, task: { ...READY.task, due_date: null } }];
    const tree = render();
    expect(
      byLabel(tree, `Due date for Book the hall: ${AI_SUGGESTION_COPY.when}`),
    ).toBeDefined();
    expect(screenText(tree)).toContain(AI_SUGGESTION_COPY.when);
  });

  it("opens the task form, not a task, for one missing who or when", async () => {
    const tree = render();
    next(tree);
    await act(async () =>
      byLabel(
        tree,
        `${AI_SUGGESTION_COPY.accept}: Order shirts`,
      ).props.onPress(),
    );
    expect(state.accept).not.toHaveBeenCalled();
    const seed = state.seed as {
      title: string;
      who: unknown;
      accept: (form: ValidatedNewTask) => Promise<void>;
    };
    expect(seed.title).toBe("Order shirts");
    expect(seed.who).toBeNull();

    // The form's Accept sends only what the officer changed.
    await seed.accept({
      title: "Order shirts",
      who: { kind: "person", userId: "u1" },
      due_date: "2026-11-20",
      subtasks: [],
    } as unknown as ValidatedNewTask);
    // A changed Who? sends every who-field, so the edit replaces the answer.
    expect(state.accept).toHaveBeenCalledWith({
      id: "s2",
      task: {
        assignee_id: "u1",
        assignee_ids: null,
        audience: null,
        audience_role_id: null,
        audience_group_id: null,
      },
    });
  });

  it("dismisses one", async () => {
    const tree = render();
    // Dismiss is worded in the card's ⋯ menu, as web's is.
    expect(menuOf(tree, "Book the hall").map((action) => action.key)).toEqual([
      "change",
      "next-agenda",
      "dismiss",
      "report",
    ]);
    await act(async () => menuAction(tree, "Book the hall", "dismiss")!.run());
    expect(state.dismiss).toHaveBeenCalledWith({ id: "s1", reason: undefined });
  });

  it("sends one to the next meeting's agenda instead of a task, and says where it went (#5790)", async () => {
    state.toNextAgenda.mockResolvedValue({
      outcome: "placed",
      meeting: {
        id: "e2",
        name: "Chapter Meeting",
        start_time: "2026-11-23T01:00:00.000Z",
      },
      source_name: "Chapter Meeting",
      text: "Book the hall",
    });
    state.undoNextAgenda.mockResolvedValue(undefined);
    const tree = render();
    await act(async () =>
      menuAction(tree, "Book the hall", "next-agenda")!.run(),
    );
    expect(state.toNextAgenda).toHaveBeenCalledWith("s1");
    expect(state.accept).not.toHaveBeenCalled();
    expect(state.dismiss).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("Added to Chapter Meeting, ");
    // Undo, in the note, takes it back.
    await act(async () => {
      tree.root
        .findAll(
          (node) =>
            node.props.accessibilityRole === "link" &&
            node.props.accessibilityLabel === AI_SUGGESTION_COPY.undo,
        )[0]!
        .props.onPress();
    });
    expect(state.undoNextAgenda).toHaveBeenCalledWith("s1");
  });

  it("doesn't offer the next meeting's agenda with Events off (#5790)", () => {
    state.eventsOn = false;
    expect(
      menuAction(render(), "Book the hall", "next-agenda"),
    ).toBeUndefined();
  });

  it("reports a suggestion by its id, and offers that only to a member who can send it", () => {
    const tree = render();
    act(() => menuAction(tree, "Book the hall", "report")!.run());
    expect(reporting.report).toHaveBeenCalledWith({
      subject: "ai_suggestion",
      subjectId: "s1",
    });
    reporting.offered = false;
    expect(menuAction(render(), "Book the hall", "report")).toBeUndefined();
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
      byLabel(
        tree,
        `${AI_SUGGESTION_COPY.accept}: Book the hall`,
      ).props.onPress(),
    );
    // The list reads again and drops the row, as the server no longer
    // lists it; the reason must still be on screen.
    state.items = [UNFINISHED];
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <SuggestedTasksScreen />
        </FrappThemeProvider>,
      ),
    );
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

describe("A suggestion that reads like an existing task (#5562)", () => {
  const HALL = {
    id: "t-hall",
    title: "Hall: book it",
    status: "IN_PROGRESS",
    due_date: "2026-11-20",
    due_at: null,
  };

  it("sets the two side by side and records Already a task as that task", async () => {
    state.tasks = [HALL];
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain(SIMILAR_TASK_COPY.heading);
    expect(text).toContain(SIMILAR_TASK_COPY.suggested);
    expect(text).toContain(SIMILAR_TASK_COPY.existing);
    expect(text).toContain("Hall: book it");
    expect(text).toContain("In progress");
    // A plain Dismiss is still in the card's menu; changing it first is not,
    // until the officer says it is a different task.
    expect(menuOf(tree, "Book the hall").map((action) => action.key)).toEqual([
      "dismiss",
      "report",
    ]);
    // Nothing creates it until the officer says which it is.
    expect(
      byLabel(tree, `${AI_SUGGESTION_COPY.accept}: Book the hall`),
    ).toBeUndefined();

    await act(async () =>
      byLabel(tree, `${SIMILAR_TASK_COPY.same}: Book the hall`).props.onPress(),
    );
    expect(state.accept).toHaveBeenCalledWith({
      id: "s1",
      task: { existing_task_id: "t-hall" },
    });
    expect(state.dismiss).not.toHaveBeenCalled();
  });

  it("opens the existing task from its side", () => {
    state.tasks = [HALL];
    const tree = render();
    act(() =>
      byLabel(
        tree,
        `${SIMILAR_TASK_COPY.openExisting}: Hall: book it`,
      ).props.onPress(),
    );
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/task-details",
      params: { id: "t-hall" },
    });
  });

  it("brings back the usual row on Create anyway", () => {
    state.tasks = [HALL];
    const tree = render();
    act(() =>
      byLabel(
        tree,
        `${SIMILAR_TASK_COPY.different}: Book the hall`,
      ).props.onPress(),
    );
    expect(screenText(tree)).not.toContain(SIMILAR_TASK_COPY.heading);
    expect(
      byLabel(tree, `${AI_SUGGESTION_COPY.accept}: Book the hall`),
    ).toBeDefined();
  });

  it("leaves a finished task alone: doing it again is new work", () => {
    state.tasks = [{ ...HALL, status: "COMPLETED" }];
    expect(screenText(render())).not.toContain(SIMILAR_TASK_COPY.heading);
  });
});

describe("This time last year", () => {
  beforeEach(() => {
    state.items = [READY, FORMAL, LAST_YEAR_TASK];
  });

  it("says what happened last year under its own heading, dates written out", () => {
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain(LAST_YEAR_COPY.heading);
    expect(text).toContain(LAST_YEAR_COPY.intro);
    expect(text).toContain("Spring formal");
    expect(text).toContain(lastYearEventLine("April 13, 2025", 1));
    // The minutes' tasks come first; last year's task is the next card.
    expect(text).toContain(AI_SUGGESTION_COPY.fromMinutesOf);
    next(tree);
    expect(screenText(tree)).toContain(lastYearTaskLine("November 18, 2025"));
  });

  it("opens the event form on last year's event, and adds nothing until it is created", async () => {
    const tree = render();
    await act(async () =>
      byLabel(
        tree,
        `${LAST_YEAR_COPY.addEvent}: Spring formal`,
      ).props.onPress(),
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
      byLabel(
        tree,
        `${LAST_YEAR_COPY.addEvent}: Spring formal`,
      ).props.onPress(),
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
    next(tree);
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
      who: { kind: "person", userId: task.assignee_id },
      due_date: task.due_date,
      subtasks: task.subtasks,
      ...over,
    }) as unknown as ValidatedNewTask;
  const CLEARED = {
    assignee_id: null,
    assignee_ids: null,
    audience: null,
    audience_role_id: null,
    audience_group_id: null,
  };

  it("sends nothing when the officer changed nothing", () => {
    expect(suggestionEdits(task as never, form())).toBeUndefined();
  });

  it("sends every who-field when the answer to Who? changes, so the edit replaces it", () => {
    expect(
      suggestionEdits(
        task as never,
        form({ who: { kind: "each", target: { kind: "chapter" } } }),
      ),
    ).toEqual({ ...CLEARED, audience: "everyone" });
    const group = { ...task, assignee_id: null, audience: "everyone" };
    expect(
      suggestionEdits(
        group as never,
        form({ who: { kind: "each", target: { kind: "chapter" } } }),
      ),
    ).toBeUndefined();
    expect(
      suggestionEdits(
        group as never,
        form({ who: { kind: "person", userId: "u2" } }),
      ),
    ).toEqual({ ...CLEARED, assignee_id: "u2" });
    expect(
      suggestionEdits(
        task as never,
        form({
          who: { kind: "someone", target: { kind: "role", id: "r1" } },
        }),
      ),
    ).toEqual({ ...CLEARED, audience: "someone", audience_role_id: "r1" });
  });

  it("reads the same people in another order as no change", () => {
    const people = {
      ...task,
      assignee_id: null,
      assignee_ids: ["u1", "u2"],
    };
    expect(
      suggestionEdits(
        people as never,
        form({
          who: {
            kind: "each",
            target: { kind: "people", userIds: ["u2", "u1"] },
          },
        }),
      ),
    ).toBeUndefined();
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
