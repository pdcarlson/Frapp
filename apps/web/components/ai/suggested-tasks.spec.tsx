import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const mocks = vi.hoisted(() => ({
  items: { current: [] as unknown[] },
  tasks: { current: [] as unknown[] | undefined },
  react: null as unknown as typeof import("react"),
  similarTask: null as unknown as typeof import("@repo/validation").similarTask,
  accept: vi.fn(),
  dismiss: vi.fn(),
  decide: vi.fn(),
  toast: vi.fn(),
  meetingsEnabled: [] as boolean[],
  currentChapter: vi.fn(),
  permissions: ["ai:use"] as string[],
}));

vi.mock("@repo/hooks", () => ({
  // Task photos (#4565): no photo reads or uploads in these cases.
  useRequestTaskPhotoUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useTaskPhotoUrl: () => ({ data: undefined }),
  // The Who picker (the card's and the task form's) reads roles, tiers and groups.
  useRoles: () => ({ data: [] }),
  useRoleTiers: () => ({ data: [] }),
  useGroups: () => ({ data: [] }),
  useCurrentUser: () => ({ data: undefined }),
  useMemberDisplayNames: () => ({ avatarTintFor: () => null }),
  useMyPermissions: () => ({ data: { permissions: mocks.permissions } }),
  useCurrentChapter: () => mocks.currentChapter(),
  useAiSuggestions: () => ({ data: { items: mocks.items.current } }),
  useAcceptAiSuggestion: () => ({ mutateAsync: mocks.accept }),
  useDismissAiSuggestion: () => ({ mutateAsync: mocks.dismiss }),
  useDecideAiSuggestions: () => ({
    mutateAsync: mocks.decide,
    isPending: false,
  }),
  useMeetings: (options?: { enabled?: boolean }) => {
    mocks.meetingsEnabled.push(options?.enabled ?? true);
    return {
      data: [
        {
          id: "m-1",
          event_name: "Chapter meeting",
          event_start_time: "2026-11-09T23:00:00.000Z",
        },
      ],
    };
  },
  // The chapter's open tasks, to spot a suggestion that is one of them
  // (#5562): `similarTask`'s own rule over these rows, with Create anyway.
  useSimilarTasks: (items: { id: string; task: { title: string } }[]) => {
    const [kept, setKept] = mocks.react.useState<ReadonlySet<string>>(
      new Set(),
    );
    return {
      twinOf: (id: string) => {
        const item = items.find((row) => row.id === id);
        if (!item || kept.has(id) || mocks.tasks.current === undefined) {
          return null;
        }
        return mocks.similarTask(
          item.task.title,
          mocks.tasks.current as {
            id: string;
            title: string;
            status: string;
          }[],
        );
      },
      keep: (id: string) => setKept((previous) => new Set(previous).add(id)),
      known: mocks.tasks.current !== undefined,
    };
  },
  existingTaskLine: (task: { status: string; due: string | null }) =>
    `${task.status} · Due ${task.due}`,
  useMembers: () => ({
    data: [
      { user_id: "u-jake", display_name: "Jake Ross" },
      { user_id: "u-sam", display_name: "Sam Lee" },
      { user_id: "u-alex", display_name: "Alex Kim" },
    ],
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

mocks.react = await import("react");
mocks.similarTask = (await import("@repo/validation")).similarTask;
const { SuggestedTasks } = await import("./suggested-tasks");

const chapter = chapterSubscription(mocks.currentChapter);

function suggestion(id: string, task: Record<string, unknown> = {}) {
  return {
    id,
    kind: "task",
    status: "pending",
    source: { type: "meeting", id: "m-1" },
    batch_id: "b-1",
    task: {
      title: `Task ${id}`,
      description: "From the minutes of Chapter meeting.",
      assignee_id: "u-jake",
      due_date: "2026-11-14",
      due_at: null,
      subtasks: [],
      ...task,
    },
    quote: `Task ${id}`,
    edited: false,
    result_id: null,
    created_at: "2026-11-10T00:00:00.000Z",
    expires_at: "2026-11-24T00:00:00.000Z",
  };
}

/** Every who-field, as an edit sends them so it replaces the whole answer. */
const noWho = {
  assignee_id: null,
  assignee_ids: null,
  audience: null,
  audience_role_id: null,
  audience_group_id: null,
};

const acceptButtons = () =>
  screen.getAllByRole("button", { name: "Create task" });

/** A card's ⋯ menu, then one of its worded items (#5562). */
function menuItem(title: string, name: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: `More: ${title}` }), {
    key: "Enter",
  });
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

/** The due chip's popover, holding the due field. */
function openDue(title: string) {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`^Due date for ${title}`) }),
  );
}

describe("SuggestedTasks (#4313)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissions = ["ai:use"];
    mocks.meetingsEnabled.length = 0;
    mocks.tasks.current = [];
    mocks.accept.mockResolvedValue({});
    mocks.dismiss.mockResolvedValue({});
    chapter.active();
  });

  it("draws nothing at all when nothing is waiting, and reads no minutes for it", () => {
    mocks.items.current = [];
    const { container } = render(<SuggestedTasks headingId="s" />);
    expect(container.innerHTML).toBe("");
    expect(mocks.meetingsEnabled.every((enabled) => !enabled)).toBe(true);
  });

  it("accepts a suggestion that says who and when in one press, sending no changes", async () => {
    mocks.items.current = [suggestion("1")];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    expect(screen.getByText("Task 1")).toBeTruthy();
    // The quote is the title's own line here, so it isn't drawn twice.
    expect(screen.queryByText("“Task 1”")).toBeNull();

    fireEvent.click(acceptButtons()[0]!);

    await waitFor(() =>
      expect(mocks.accept).toHaveBeenCalledWith({ id: "1", task: undefined }),
    );
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Task created",
      description: "Task 1",
    });
  });

  it("asks who and when on Accept when the minutes named neither, and sends nothing", () => {
    mocks.items.current = [
      suggestion("1", { assignee_id: null, due_date: null }),
    ];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    // Not flagged before the officer asks for anything.
    expect(screen.queryByText("Pick who this is for.")).toBeNull();

    fireEvent.click(acceptButtons()[0]!);

    expect(screen.getByText("Pick who this is for.")).toBeTruthy();
    // The date chip turns to the warning tone, and the card says why, with
    // the chip's popover closed.
    const dueChip = screen.getByRole("button", { name: "Due date for Task 1" });
    expect(dueChip.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Pick a due date.").id).toBe(
      dueChip.getAttribute("aria-describedby"),
    );
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("sends the day the officer typed in place", async () => {
    mocks.items.current = [suggestion("1", { due_date: null })];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    openDue("Task 1");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Due date for Task 1" }),
      {
        target: { value: "12/25/2030" },
      },
    );
    fireEvent.click(acceptButtons()[0]!);

    await waitFor(() =>
      expect(mocks.accept).toHaveBeenCalledWith({
        id: "1",
        task: { due_date: "2030-12-25", due_at: null },
      }),
    );
  });

  it("sends Everyone as the audience when picked in Who? (#4295)", async () => {
    mocks.items.current = [suggestion("1", { assignee_id: null })];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    await userEvent.click(screen.getByLabelText("Assignee for Task 1"));
    await userEvent.click(
      await screen.findByRole("checkbox", { name: /Everyone in the chapter/ }),
    );
    await userEvent.keyboard("{Escape}");
    fireEvent.click(acceptButtons()[0]!);

    await waitFor(() =>
      expect(mocks.accept).toHaveBeenCalledWith({
        id: "1",
        task: { ...noWho, audience: "everyone" },
      }),
    );
  });

  it("reads a suggestion for everyone as ready to accept, sending no changes", async () => {
    mocks.items.current = [
      suggestion("1", { assignee_id: null, audience: "everyone" }),
    ];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    fireEvent.click(acceptButtons()[0]!);
    await waitFor(() =>
      expect(mocks.accept).toHaveBeenCalledWith({ id: "1", task: undefined }),
    );
  });

  it("reads a suggestion up for grabs in a role as ready to create, sending no changes", async () => {
    mocks.items.current = [
      suggestion("1", {
        assignee_id: null,
        audience: "someone",
        audience_role_id: "r-social",
      }),
    ];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    fireEvent.click(acceptButtons()[0]!);
    await waitFor(() =>
      expect(mocks.accept).toHaveBeenCalledWith({ id: "1", task: undefined }),
    );
  });

  it("puts a suggestion up for grabs between two members picked on the card", async () => {
    mocks.items.current = [suggestion("1", { assignee_id: null })];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    await userEvent.click(screen.getByLabelText("Assignee for Task 1"));
    await userEvent.click(
      await screen.findByRole("checkbox", { name: /Jake Ross/ }),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Sam Lee/ }));
    await userEvent.click(screen.getByRole("radio", { name: "One claims it" }));
    await userEvent.keyboard("{Escape}");
    fireEvent.click(acceptButtons()[0]!);

    await waitFor(() => expect(mocks.accept).toHaveBeenCalled());
    const sent = mocks.accept.mock.calls[0]![0];
    expect(sent.id).toBe("1");
    expect(sent.task).toEqual({
      ...noWho,
      audience: "someone",
      assignee_ids: expect.arrayContaining(["u-jake", "u-sam"]),
    });
  });

  it("keeps a role's up-for-grabs pick through Change before creating", async () => {
    mocks.items.current = [
      suggestion("1", {
        assignee_id: null,
        audience: "someone",
        audience_role_id: "r-social",
      }),
    ];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    menuItem("Task 1", "Change before creating");
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Book the bus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(mocks.accept).toHaveBeenCalled());
    expect(mocks.accept.mock.calls[0]![0].task).toEqual(
      expect.objectContaining({
        title: "Book the bus",
        ...noWho,
        audience: "someone",
        audience_role_id: "r-social",
      }),
    );
  });

  it("offers Report this on each suggestion (#4315)", () => {
    mocks.items.current = [suggestion("1")];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "More: Task 1" }), {
      key: "Enter",
    });
    expect(screen.getByRole("menuitem", { name: "Report this" })).toBeTruthy();
  });

  it("offers no Report this to a member who can't use AI", () => {
    mocks.permissions = [];
    mocks.items.current = [suggestion("1")];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "More: Task 1" }), {
      key: "Enter",
    });
    expect(screen.getByRole("menuitem", { name: "Dismiss" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Report this" })).toBeNull();
  });

  it("dismisses without asking for anything", async () => {
    mocks.items.current = [
      suggestion("1", { assignee_id: null, due_date: null }),
    ];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    menuItem("Task 1", "Dismiss");
    await waitFor(() =>
      expect(mocks.dismiss).toHaveBeenCalledWith({
        id: "1",
        reason: undefined,
      }),
    );
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("opens the task form on the suggestion, with no points to set, and accepts what it holds", async () => {
    mocks.items.current = [suggestion("1")];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    menuItem("Task 1", "Change before creating");

    const title = screen.getByLabelText("Title");
    expect((title as HTMLInputElement).value).toBe("Task 1");
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    expect(screen.queryByLabelText("Points")).toBeNull();
    expect(screen.getByLabelText("Description")).toBeTruthy();

    fireEvent.change(title, { target: { value: "Book the bus" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(mocks.accept).toHaveBeenCalledWith({
        id: "1",
        task: {
          title: "Book the bus",
          description: "From the minutes of Chapter meeting.",
          ...noWho,
          assignee_id: "u-jake",
          due_date: "2026-11-14",
          due_at: null,
          subtasks: [],
        },
      }),
    );
  });

  it("says in plain words when another officer got there first", async () => {
    mocks.items.current = [suggestion("1")];
    mocks.accept.mockRejectedValue({ code: "ai.suggestion.decided" });
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    fireEvent.click(acceptButtons()[0]!);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "Couldn't create the task",
        description: "Another officer already decided this one.",
        variant: "destructive",
      }),
    );
  });

  it("offers to accept together only the ones that say who and when, under the rows", async () => {
    mocks.items.current = [
      suggestion("1"),
      suggestion("2"),
      suggestion("3", { assignee_id: null }),
    ];
    mocks.decide.mockResolvedValue([
      { id: "1", ok: true },
      { id: "2", ok: false, code: "ai.suggestion.decided" },
    ]);
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    const all = screen.getByRole("button", {
      name: "Create the 2 that say who and when",
    });
    // Under the card, never in its place.
    expect(
      screen.getByText("Task 1").compareDocumentPosition(all) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(all);

    await waitFor(() =>
      expect(mocks.decide).toHaveBeenCalledWith([
        { id: "1", action: "accept", task: undefined },
        { id: "2", action: "accept", task: undefined },
      ]),
    );
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "1 task created",
      description: "1 couldn't be created and is still listed.",
      variant: undefined,
    });
  });

  it("offers no Create all for a single suggestion", () => {
    mocks.items.current = [suggestion("1")];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    expect(screen.queryByRole("button", { name: /create all/i })).toBeNull();
  });

  it("names the minutes the board's suggestion came from, linking back to them", () => {
    mocks.items.current = [suggestion("1"), suggestion("2")];
    render(<SuggestedTasks headingId="s" />);
    const link = screen.getByRole("link", { name: /Chapter meeting, / });
    expect(link.getAttribute("href")).toBe("/meetings/m-1");
    // Written out, never "Mon" or "Nov 9".
    expect(link.textContent).toMatch(/November/);
    expect(screen.getByRole("button", { name: "Create all 2" })).toBeTruthy();
  });

  it("shows the line of the minutes when the title had to be cut from it", () => {
    mocks.items.current = [
      { ...suggestion("1"), quote: "The whole long line" },
    ];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    expect(screen.getByText("“The whole long line”")).toBeTruthy();
  });

  it("says where a suggestion from last year's board came from, and takes Already planned in one press (#3930)", async () => {
    mocks.items.current = [
      {
        ...suggestion("1", {
          assignee_id: null,
          due_date: "2027-04-12",
          last_year_on: "2026-04-13",
        }),
        source: { type: "task", id: "t-old" },
      },
    ];
    render(<SuggestedTasks headingId="s" />);
    // What happened, that it isn't seen this year, and the invitation to
    // correct it; the date written out with its year.
    expect(
      screen.getByText(
        "This time last year: done by April 13, 2026. I don’t see it on this year’s board. Correct me if it’s already handled.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Already planned" }));

    await waitFor(() =>
      expect(mocks.dismiss).toHaveBeenCalledWith({
        id: "1",
        reason: "already_doing",
      }),
    );
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("offers Already planned only on a suggestion from last year", () => {
    mocks.items.current = [suggestion("1")];
    render(<SuggestedTasks headingId="s" />);
    expect(
      screen.queryByRole("button", { name: "Already planned" }),
    ).toBeNull();
  });

  it("shows one suggestion at a time, in order, and moves between them (Paul, 2026-11-18)", () => {
    mocks.items.current = [suggestion("1"), suggestion("2"), suggestion("3")];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    expect(screen.getByText("Task 1")).toBeTruthy();
    expect(screen.queryByText("Task 2")).toBeNull();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Previous suggestion",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Next suggestion" }));
    expect(screen.getByText("Task 2")).toBeTruthy();
    expect(screen.getByText("2 of 3")).toBeTruthy();
  });

  it("brings the next suggestion up in place once one is decided", () => {
    mocks.items.current = [suggestion("1"), suggestion("2")];
    const { rerender } = render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    mocks.items.current = [suggestion("2")];
    rerender(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    expect(screen.getByText("Task 2")).toBeTruthy();
    expect(screen.queryByText("1 of 1")).toBeNull();
  });

  it("fills in who the line names and a day a week after the meeting, says so, and sends them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00"));
    try {
      mocks.items.current = [
        {
          ...suggestion("1", {
            title: "Sam to book the bus",
            assignee_id: null,
            due_date: null,
          }),
          quote: "Sam to book the bus",
        },
      ];
      render(
        <SuggestedTasks
          source={{ type: "meeting", id: "m-1" }}
          sourceStart="2026-11-09T19:00:00"
          headingId="s"
        />,
      );
      // Frapp's guesses are dashed chips that say so to a screen reader.
      expect(
        screen.getByRole("button", {
          name: /^Assignee for Sam to book the bus, suggested from the minutes/,
        }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", {
          name: /Suggested: a week after the meeting$/,
        }),
      ).toBeTruthy();

      fireEvent.click(acceptButtons()[0]!);
      await waitFor(() =>
        expect(mocks.accept).toHaveBeenCalledWith({
          id: "1",
          task: {
            ...noWho,
            assignee_id: "u-sam",
            due_date: "2026-11-16",
            due_at: null,
          },
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves Frapp's guesses out of Create all: only what the minutes or the officer said", async () => {
    mocks.items.current = [
      suggestion("1"),
      suggestion("2"),
      {
        ...suggestion("3", { title: "Sam to book the bus", assignee_id: null }),
        quote: "Sam to book the bus",
      },
    ];
    mocks.decide.mockResolvedValue([
      { id: "1", ok: true },
      { id: "2", ok: true },
    ]);
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Create the 2 that say who and when",
      }),
    );
    await waitFor(() =>
      expect(mocks.decide).toHaveBeenCalledWith([
        { id: "1", action: "accept", task: undefined },
        { id: "2", action: "accept", task: undefined },
      ]),
    );
  });

  it("suggests nobody for last year's task, even when its title names a member (#3930)", () => {
    mocks.items.current = [
      {
        ...suggestion("1", {
          title: "Sam to book the bus",
          assignee_id: null,
          last_year_on: "2025-11-13",
        }),
        quote: "Sam to book the bus",
        source: { type: "task", id: "t-old" },
      },
    ];
    render(<SuggestedTasks headingId="s" />);
    expect(screen.queryByText("Suggested from the minutes")).toBeNull();
  });

  it("keeps the other suggestions in reach while one is being created", () => {
    mocks.accept.mockReturnValue(new Promise(() => {}));
    mocks.items.current = [suggestion("1"), suggestion("2")];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    fireEvent.click(acceptButtons()[0]!);
    expect(screen.getByRole("button", { name: "Creating…" })).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Next suggestion",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  describe("a suggestion that reads like an existing task (#5562)", () => {
    const existing = {
      id: "t-hall",
      title: "Formal: book the hall",
      status: "IN_PROGRESS",
      due: "2026-11-20",
    };

    it("sets the two side by side and records Already a task as that task", async () => {
      mocks.tasks.current = [existing];
      mocks.items.current = [
        suggestion("1", { title: "Book the hall for formal" }),
      ];
      render(
        <SuggestedTasks
          source={{ type: "meeting", id: "m-1" }}
          headingId="s"
        />,
      );
      expect(
        screen.getByText("Looks like a task you already have"),
      ).toBeTruthy();
      expect(screen.getByText("Book the hall for formal")).toBeTruthy();
      expect(screen.getByText("Formal: book the hall")).toBeTruthy();
      expect(screen.getByText("IN_PROGRESS · Due 2026-11-20")).toBeTruthy();
      expect(
        screen
          .getByRole("link", { name: "Open the existing task" })
          .getAttribute("href"),
      ).toBe("/tasks?task=t-hall");
      // Nothing creates it until the officer says which it is.
      expect(screen.queryByRole("button", { name: "Create task" })).toBeNull();

      // A plain Dismiss is still in the card's menu.
      fireEvent.keyDown(
        screen.getByRole("button", { name: "More: Book the hall for formal" }),
        { key: "Enter" },
      );
      expect(screen.getByRole("menuitem", { name: "Dismiss" })).toBeTruthy();
      fireEvent.keyDown(screen.getByRole("menuitem", { name: "Dismiss" }), {
        key: "Escape",
      });

      fireEvent.click(screen.getByRole("button", { name: "Already a task" }));
      await waitFor(() =>
        expect(mocks.accept).toHaveBeenCalledWith({
          id: "1",
          task: { existing_task_id: "t-hall" },
        }),
      );
      expect(mocks.dismiss).not.toHaveBeenCalled();
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "Noted as a task you already have",
        description: "Formal: book the hall",
      });
    });

    it("brings back the usual card on Create anyway", () => {
      mocks.tasks.current = [existing];
      mocks.items.current = [
        suggestion("1", { title: "Book the hall for formal" }),
      ];
      render(
        <SuggestedTasks
          source={{ type: "meeting", id: "m-1" }}
          headingId="s"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Create anyway" }));
      expect(
        screen.queryByText("Looks like a task you already have"),
      ).toBeNull();
      expect(screen.getByRole("button", { name: "Create task" })).toBeTruthy();
    });

    it("leaves a finished task alone: doing it again is new work", () => {
      mocks.tasks.current = [{ ...existing, status: "COMPLETED" }];
      mocks.items.current = [
        suggestion("1", { title: "Book the hall for formal" }),
      ];
      render(
        <SuggestedTasks
          source={{ type: "meeting", id: "m-1" }}
          headingId="s"
        />,
      );
      expect(
        screen.queryByText("Looks like a task you already have"),
      ).toBeNull();
    });

    it("offers no Create all until the task list has been read", () => {
      mocks.tasks.current = undefined;
      mocks.items.current = [suggestion("1"), suggestion("2")];
      render(
        <SuggestedTasks
          source={{ type: "meeting", id: "m-1" }}
          headingId="s"
        />,
      );
      expect(screen.queryByRole("button", { name: /^Create all/ })).toBeNull();
    });

    it("leaves a likely duplicate out of Create all until the officer says", () => {
      mocks.tasks.current = [existing];
      mocks.items.current = [
        suggestion("1"),
        suggestion("2"),
        suggestion("3", { title: "Book the hall for formal" }),
      ];
      render(
        <SuggestedTasks
          source={{ type: "meeting", id: "m-1" }}
          headingId="s"
        />,
      );
      expect(
        screen.getByRole("button", {
          name: "Create the 2 that are ready",
        }),
      ).toBeTruthy();
    });
  });
});
