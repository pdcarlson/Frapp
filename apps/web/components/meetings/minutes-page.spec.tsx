import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingMinutes } from "@repo/hooks";

const mocks = vi.hoisted(() => ({
  meeting: { current: null as unknown },
  update: vi.fn(),
  post: vi.fn(),
  remove: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useMeeting: () => mocks.meeting.current,
  useUpdateMeeting: () => ({ mutateAsync: mocks.update, isPending: false }),
  usePostMeeting: () => ({ mutateAsync: mocks.post, isPending: false }),
  useDeleteMeeting: () => ({ mutateAsync: mocks.remove, isPending: false }),
  useMemberDisplayNames: () => ({
    nameFor: (id: string) =>
      ({
        "11111111-1111-4111-8111-111111111111": "Jake Ross",
        "22222222-2222-4222-8222-222222222222": "Sam Lee",
      })[id] ?? null,
  }),
  useChapterRoster: () => ({
    data: [
      {
        user_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Jake Ross",
      },
      {
        user_id: "22222222-2222-4222-8222-222222222222",
        display_name: "Sam Lee",
      },
    ],
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/components/shared/confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: mocks.confirm, confirmDialog: null }),
}));

const { MinutesPage } = await import("./minutes-page");

const EMPTY = {
  summary: "",
  announcements: "",
  decisions: [],
  action_items: [],
  officer_reports: "",
  old_business: "",
  new_business: "",
  discussion_log: "",
};

function minutes(overrides: Partial<MeetingMinutes> = {}): MeetingMinutes {
  return {
    id: "m-1",
    event_id: "e-1",
    event_name: "Chapter meeting",
    event_start_time: "2026-11-09T23:00:00.000Z",
    event_end_time: "2026-11-10T00:00:00.000Z",
    meeting_type: "chapter",
    other_label: null,
    status: "posted",
    created_by: "11111111-1111-4111-8111-111111111111",
    updated_by: "11111111-1111-4111-8111-111111111111",
    posted_by: "11111111-1111-4111-8111-111111111111",
    posted_at: "2026-11-10T01:00:00.000Z",
    updated_at: "2026-11-10T01:00:00.000Z",
    created_at: "2026-11-09T23:00:00.000Z",
    content: {
      ...EMPTY,
      summary: "Budget approved.",
      decisions: [
        {
          text: "Approve the formal budget",
          vote: { for: 30, against: 2, abstain: 1 },
        },
      ],
      action_items: [
        {
          text: "Book the venue",
          owner_user_id: "22222222-2222-4222-8222-222222222222",
          due_date: "2026-11-14",
        },
      ],
    },
    sections: [
      "attendees",
      "summary",
      "announcements",
      "decisions",
      "action_items",
    ],
    attendees: {
      present: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ],
      late: [],
      excused: [],
    },
    can_edit: false,
    can_delete: false,
    ...overrides,
  } as MeetingMinutes;
}

function loaded(meeting: MeetingMinutes) {
  mocks.meeting.current = {
    isPending: false,
    data: meeting,
    error: null,
    refetch: mocks.refetch,
  };
}

beforeEach(() => {
  for (const fn of [
    mocks.update,
    mocks.post,
    mocks.remove,
    mocks.refetch,
    mocks.toast,
    mocks.push,
    mocks.confirm,
  ]) {
    fn.mockReset();
  }
});

describe("MinutesPage", () => {
  it("reads posted minutes as a document, with only the sections that hold something", () => {
    loaded(minutes());
    render(<MinutesPage id="m-1" />);
    expect(
      screen.getByRole("heading", { name: "Chapter meeting" }),
    ).toBeTruthy();
    expect(screen.getByText("Budget approved.")).toBeTruthy();
    expect(screen.getByText("30 for, 2 against, 1 abstaining")).toBeTruthy();
    expect(screen.getByText(/Sam Lee · Due/)).toBeTruthy();
    expect(screen.getByText("Jake Ross, Sam Lee")).toBeTruthy();
    // Announcements is in the template but empty, so it isn't drawn.
    expect(screen.queryByRole("heading", { name: "Announcements" })).toBeNull();
    // A member who can't edit gets no Edit or Delete.
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("says the minutes aren't here on a 404, without a retry", () => {
    mocks.meeting.current = {
      isPending: false,
      data: undefined,
      error: { statusCode: 404 },
      refetch: mocks.refetch,
    };
    render(<MinutesPage id="m-1" />);
    expect(screen.getByText("These minutes aren't here")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("opens the author's draft as its editor and saves against the version it loaded", async () => {
    const draft = minutes({
      status: "draft",
      posted_at: null,
      posted_by: null,
      can_edit: true,
      can_delete: true,
      content: EMPTY,
    });
    loaded(draft);
    mocks.update.mockResolvedValue({
      ...draft,
      updated_at: "2026-11-10T02:00:00.000Z",
      content: { ...EMPTY, summary: "We met." },
    });
    render(<MinutesPage id="m-1" />);
    expect(screen.getByRole("button", { name: "Saved" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
      target: { value: "We met." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      id: "m-1",
      body: {
        expected_updated_at: "2026-11-10T01:00:00.000Z",
        meeting_type: "chapter",
        other_label: null,
        content: { summary: "We met." },
      },
    });
  });

  it("drops a blank decision row rather than sending it", async () => {
    const draft = minutes({
      status: "draft",
      posted_at: null,
      can_edit: true,
      content: EMPTY,
    });
    loaded(draft);
    mocks.update.mockResolvedValue(draft);
    render(<MinutesPage id="m-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add a decision" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
      target: { value: "Short one." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0][0].body.content.decisions).toEqual([]);
  });

  it("says someone else saved, and keeps the typing, when a save is stale", async () => {
    const draft = minutes({
      status: "draft",
      posted_at: null,
      can_edit: true,
      content: EMPTY,
    });
    loaded(draft);
    mocks.update.mockRejectedValue({ statusCode: 409, code: "meeting.stale" });
    render(<MinutesPage id="m-1" />);
    const summary = screen.getByRole("textbox", { name: "Summary" });
    fireEvent.change(summary, { target: { value: "Mine." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText(/Someone else saved these minutes/),
    ).toBeTruthy();
    expect((summary as HTMLTextAreaElement).value).toBe("Mine.");
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("asks before posting, then posts the saved version", async () => {
    const draft = minutes({
      status: "draft",
      posted_at: null,
      can_edit: true,
      content: { ...EMPTY, summary: "Done." },
    });
    loaded(draft);
    mocks.confirm.mockResolvedValue({ comment: "" });
    mocks.post.mockResolvedValue({ ...draft, status: "posted" });
    render(<MinutesPage id="m-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Post minutes" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledWith({
      id: "m-1",
      expectedUpdatedAt: "2026-11-10T01:00:00.000Z",
    });
  });

  it("asks for a name for an Other meeting before saving", async () => {
    const draft = minutes({
      status: "draft",
      posted_at: null,
      can_edit: true,
      content: EMPTY,
    });
    loaded(draft);
    render(<MinutesPage id="m-1" />);
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Name this meeting.")).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
