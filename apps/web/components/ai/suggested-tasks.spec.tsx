import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const mocks = vi.hoisted(() => ({
  items: { current: [] as unknown[] },
  accept: vi.fn(),
  dismiss: vi.fn(),
  decide: vi.fn(),
  toast: vi.fn(),
  meetingsEnabled: [] as boolean[],
  currentChapter: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useMyPermissions: () => ({ data: { permissions: ["ai:use"] } }),
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
  useMembers: () => ({
    data: [
      { user_id: "u-jake", display_name: "Jake Ross" },
      { user_id: "u-sam", display_name: "Sam Lee" },
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

const acceptButtons = () => screen.getAllByRole("button", { name: "Accept" });

describe("SuggestedTasks (#4313)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.meetingsEnabled.length = 0;
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
    expect(screen.getByText("Pick a due date.")).toBeTruthy();
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("sends the day the officer typed in place", async () => {
    mocks.items.current = [suggestion("1", { due_date: null })];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    fireEvent.change(screen.getByLabelText("Due date for Task 1"), {
      target: { value: "12/25/2030" },
    });
    fireEvent.click(acceptButtons()[0]!);

    await waitFor(() =>
      expect(mocks.accept).toHaveBeenCalledWith({
        id: "1",
        task: { due_date: "2030-12-25", due_at: null },
      }),
    );
  });

  it("offers Report this on each suggestion (#4315)", () => {
    mocks.items.current = [suggestion("1")];
    render(<SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />);
    expect(screen.getByRole("button", { name: "Report Task 1" })).toBeTruthy();
  });

  it("dismisses without asking for anything", async () => {
    mocks.items.current = [
      suggestion("1", { assignee_id: null, due_date: null }),
    ];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss / }));
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
    fireEvent.click(
      screen.getByRole("button", { name: "Change Task 1 before accepting" }),
    );

    const title = screen.getByLabelText("Title");
    expect((title as HTMLInputElement).value).toBe("Task 1");
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    expect(screen.queryByLabelText("Points")).toBeNull();
    expect(screen.getByLabelText("Description")).toBeTruthy();

    fireEvent.change(title, { target: { value: "Book the bus" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(mocks.accept).toHaveBeenCalledWith({
        id: "1",
        task: {
          title: "Book the bus",
          description: "From the minutes of Chapter meeting.",
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
        title: "Couldn't accept the suggestion",
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
      name: "Accept the 2 with an assignee and a due date",
    });
    // After every row in the document: the officer has been past them.
    const rows = screen.getAllByRole("listitem");
    expect(
      rows[rows.length - 1]!.compareDocumentPosition(all) &
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
      description: "1 couldn't be accepted and is still listed.",
      variant: undefined,
    });
  });

  it("offers no Accept all for a single suggestion", () => {
    mocks.items.current = [suggestion("1")];
    render(
      <SuggestedTasks source={{ type: "meeting", id: "m-1" }} headingId="s" />,
    );
    expect(screen.queryByRole("button", { name: /accept all/i })).toBeNull();
  });

  it("groups the board's list by the minutes each came from, linking back to them", () => {
    mocks.items.current = [suggestion("1"), suggestion("2")];
    render(<SuggestedTasks headingId="s" />);
    const link = screen.getByRole("link", { name: /Chapter meeting, / });
    expect(link.getAttribute("href")).toBe("/meetings/m-1");
    // Written out, never "Mon" or "Nov 9".
    expect(link.textContent).toMatch(/November/);
    expect(screen.getByRole("button", { name: "Accept all 2" })).toBeTruthy();
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
});
