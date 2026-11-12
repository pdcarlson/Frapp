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
  draft: { current: null as unknown },
  requestDraft: vi.fn(),
  discardDraft: vi.fn(),
  useDraft: vi.fn(),
  ensureConsent: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useMeeting: () => mocks.meeting.current,
  useUpdateMeeting: () => ({ mutateAsync: mocks.update, isPending: false }),
  usePostMeeting: () => ({ mutateAsync: mocks.post, isPending: false }),
  useDeleteMeeting: () => ({ mutateAsync: mocks.remove, isPending: false }),
  useMeetingDraft: () => ({ isPending: false, data: mocks.draft.current }),
  useRequestMeetingDraft: () => ({
    mutateAsync: mocks.requestDraft,
    isPending: false,
  }),
  useUseMeetingDraft: () => ({ mutateAsync: mocks.useDraft, isPending: false }),
  useDiscardMeetingDraft: () => ({
    mutateAsync: mocks.discardDraft,
    isPending: false,
  }),
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

// The list has its own spec; here only where the page puts it.
vi.mock("@/components/ai/suggested-tasks", () => ({
  SuggestedTasks: ({ source }: { source: { type: string; id: string } }) => (
    <div data-testid="suggested-tasks">{`${source.type}:${source.id}`}</div>
  ),
}));

vi.mock("@/components/ai/ai-consent-sheet", () => ({
  useAiConsentGate: () => ({
    ensureConsent: mocks.ensureConsent,
    consentDialog: null,
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
    mocks.requestDraft,
    mocks.discardDraft,
    mocks.useDraft,
    mocks.ensureConsent,
  ]) {
    fn.mockReset();
  }
  mocks.draft.current = null;
});

const NO_DRAFT = {
  status: "none",
  notes: "",
  failure: null,
  failure_message: null,
  content: null,
  review: { gaps: [], sources: [], left_out: 0 },
  requested_at: null,
  blocked: null,
};

function ownDraft(overrides: Partial<MeetingMinutes> = {}): MeetingMinutes {
  return minutes({
    status: "draft",
    posted_at: null,
    posted_by: null,
    can_edit: true,
    can_delete: true,
    content: EMPTY,
    ...overrides,
  });
}

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

  it("lists suggested tasks under posted minutes, and never beside a draft or the editor", () => {
    loaded(minutes({ can_edit: true }));
    const { unmount } = render(<MinutesPage id="m-1" />);
    expect(screen.getByTestId("suggested-tasks").textContent).toBe(
      "meeting:m-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByTestId("suggested-tasks")).toBeNull();
    unmount();

    loaded(minutes({ status: "draft", posted_at: null, can_edit: true }));
    render(<MinutesPage id="m-1" />);
    expect(screen.queryByTestId("suggested-tasks")).toBeNull();
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
    expect(mocks.update.mock.calls[0]![0]).toMatchObject({
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
    expect(mocks.update.mock.calls[0]![0].body.content.decisions).toEqual([]);
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

  it("saves an Other meeting without a name, since the name is optional", async () => {
    const draft = minutes({
      status: "draft",
      posted_at: null,
      can_edit: true,
      content: EMPTY,
    });
    loaded(draft);
    mocks.update.mockResolvedValue({ ...draft, meeting_type: "other" });
    render(<MinutesPage id="m-1" />);
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0]![0].body).toMatchObject({
      meeting_type: "other",
      other_label: null,
    });
  });

  it("loads their version, then saves against it rather than the version it first opened", async () => {
    const draft = minutes({
      status: "draft",
      posted_at: null,
      can_edit: true,
      content: EMPTY,
    });
    const theirs = {
      ...draft,
      updated_at: "2026-11-10T03:00:00.000Z",
      content: { ...EMPTY, summary: "Theirs." },
    };
    loaded(draft);
    mocks.update
      .mockRejectedValueOnce({ statusCode: 409, code: "meeting.stale" })
      .mockResolvedValueOnce({
        ...theirs,
        updated_at: "2026-11-10T04:00:00.000Z",
        content: { ...EMPTY, summary: "Theirs, and mine." },
      });
    mocks.refetch.mockResolvedValue({ data: theirs });
    render(<MinutesPage id="m-1" />);
    const summary = () =>
      screen.getByRole("textbox", { name: "Summary" }) as HTMLTextAreaElement;
    fireEvent.change(summary(), { target: { value: "Mine." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Load their version" }),
    );
    await waitFor(() => expect(summary().value).toBe("Theirs."));
    expect(screen.queryByText(/Someone else saved these minutes/)).toBeNull();
    fireEvent.change(summary(), { target: { value: "Theirs, and mine." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[1]![0].body).toMatchObject({
      expected_updated_at: "2026-11-10T03:00:00.000Z",
      content: { summary: "Theirs, and mine." },
    });
  });

  it("shows a newer version that arrives while nothing is typed", () => {
    const draft = minutes({
      status: "draft",
      posted_at: null,
      can_edit: true,
      content: EMPTY,
    });
    loaded(draft);
    const view = render(<MinutesPage id="m-1" />);
    loaded({
      ...draft,
      updated_at: "2026-11-10T03:00:00.000Z",
      content: { ...EMPTY, summary: "Newer." },
    });
    view.rerender(<MinutesPage id="m-1" />);
    expect(
      (screen.getByRole("textbox", { name: "Summary" }) as HTMLTextAreaElement)
        .value,
    ).toBe("Newer.");
  });

  describe("drafting from notes", () => {
    it("shows no notes box where drafting isn't offered", () => {
      loaded(ownDraft());
      render(<MinutesPage id="m-1" />);
      expect(screen.queryByRole("heading", { name: "Your notes" })).toBeNull();
      mocks.draft.current = { ...NO_DRAFT, blocked: "chapter_off" };
      render(<MinutesPage id="m-1" />);
      expect(screen.queryByRole("heading", { name: "Your notes" })).toBeNull();
    });

    it("asks for a draft against the version on screen, with the meeting's day", async () => {
      mocks.draft.current = NO_DRAFT;
      loaded(ownDraft());
      mocks.refetch.mockResolvedValue({ data: ownDraft() });
      mocks.requestDraft.mockResolvedValue({ ...NO_DRAFT, status: "drafting" });
      render(<MinutesPage id="m-1" />);
      // Empty notes are caught on the ask, not while typing.
      fireEvent.click(screen.getByRole("button", { name: "Draft minutes" }));
      expect(screen.getByText("Paste or type your notes first.")).toBeTruthy();
      expect(mocks.requestDraft).not.toHaveBeenCalled();

      fireEvent.change(screen.getByRole("textbox", { name: "Your notes" }), {
        target: { value: "voted yes on formal budget 30-2" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Draft minutes" }));
      await waitFor(() => expect(mocks.requestDraft).toHaveBeenCalledTimes(1));
      // Nothing was written yet, so nothing is replaced and nobody is asked.
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(mocks.requestDraft.mock.calls[0]![0]).toMatchObject({
        id: "m-1",
        body: {
          notes: "voted yes on formal budget 30-2",
          expected_updated_at: "2026-11-10T01:00:00.000Z",
        },
      });
      expect(mocks.requestDraft.mock.calls[0]![0].body.meeting_date).toMatch(
        /^2026-11-(09|10)$/,
      );
    });

    it("asks before a draft replaces what is written, and saves typing first", async () => {
      mocks.draft.current = NO_DRAFT;
      const draft = ownDraft();
      loaded(draft);
      mocks.confirm.mockResolvedValue({ comment: "" });
      mocks.update.mockResolvedValue({
        ...draft,
        updated_at: "2026-11-10T02:00:00.000Z",
        content: { ...EMPTY, summary: "We met." },
      });
      mocks.requestDraft.mockResolvedValue({ ...NO_DRAFT, status: "drafting" });
      render(<MinutesPage id="m-1" />);
      fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
        target: { value: "We met." },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "Your notes" }), {
        target: { value: "notes" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Draft minutes" }));
      await waitFor(() => expect(mocks.requestDraft).toHaveBeenCalledTimes(1));
      expect(mocks.confirm.mock.calls[0]![0].title).toBe(
        "Replace what's written?",
      );
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(
        mocks.requestDraft.mock.calls[0]![0].body.expected_updated_at,
      ).toBe("2026-11-10T02:00:00.000Z");
    });

    it("holds the sections still while a draft is written, and offers Stop", () => {
      mocks.draft.current = { ...NO_DRAFT, status: "drafting", notes: "notes" };
      loaded(ownDraft());
      render(<MinutesPage id="m-1" />);
      expect(screen.getByText("Drafting minutes from your notes")).toBeTruthy();
      // The sections sit in a disabled fieldset, so every field in it waits.
      expect(
        screen.getByRole("textbox", { name: "Summary" }).matches(":disabled"),
      ).toBe(true);
      expect(
        screen.getByRole("button", { name: "Post minutes" }),
      ).toHaveProperty("disabled", true);
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      // Stopping keeps the notes, stored and in the box.
      expect(mocks.discardDraft).toHaveBeenCalledWith({
        id: "m-1",
        keepNotes: true,
      });
      expect(
        screen.getByRole("textbox", { name: "Your notes" }),
      ).toHaveProperty("value", "notes");
    });

    it("shows what to fill in and the line each drafted item came from", () => {
      mocks.draft.current = {
        ...NO_DRAFT,
        status: "applied",
        notes: "voted yes on formal budget 30-2",
        review: {
          gaps: ["The notes don't say who is booking the venue."],
          sources: [
            {
              kind: "decision",
              text: "Approve the formal budget",
              quote: "voted yes on formal budget 30-2",
            },
          ],
          left_out: 1,
        },
      };
      loaded(
        ownDraft({
          content: {
            ...EMPTY,
            decisions: [
              {
                text: "Approve the formal budget",
                vote: { for: 30, against: 2, abstain: 0 },
              },
            ],
          },
        }),
      );
      render(<MinutesPage id="m-1" />);
      expect(
        screen.getByText("The notes don't say who is booking the venue."),
      ).toBeTruthy();
      expect(
        screen.getByText(
          "One drafted line was left out because nothing in your notes backed it.",
        ),
      ).toBeTruthy();
      expect(
        screen.getByText("From your notes: “voted yes on formal budget 30-2”"),
      ).toBeTruthy();
      // Once the officer rewrites the line it is theirs, and the quote goes.
      fireEvent.change(screen.getByRole("textbox", { name: "Decision 1" }), {
        target: { value: "Approve the budget" },
      });
      expect(screen.queryByText(/^From your notes:/)).toBeNull();
      expect(screen.getByRole("button", { name: "Draft again" })).toBeTruthy();
    });

    it("puts a draft that waited into the minutes only when asked, on the newest version", async () => {
      mocks.draft.current = {
        ...NO_DRAFT,
        status: "ready",
        notes: "notes",
        content: { ...EMPTY, summary: "Drafted summary." },
      };
      const mine = ownDraft({ content: { ...EMPTY, summary: "Mine." } });
      loaded(mine);
      // Someone saved while the draft was written, which is why it waited.
      mocks.refetch.mockResolvedValue({
        data: { ...mine, updated_at: "2026-11-10T03:00:00.000Z" },
      });
      mocks.confirm.mockResolvedValue({ comment: "" });
      mocks.useDraft.mockResolvedValue({ ...NO_DRAFT, status: "applied" });
      render(<MinutesPage id="m-1" />);
      expect(screen.getByRole("textbox", { name: "Summary" })).toHaveProperty(
        "value",
        "Mine.",
      );
      expect(mocks.useDraft).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Use the draft" }));
      await waitFor(() => expect(mocks.useDraft).toHaveBeenCalledTimes(1));
      // It replaces what is written, so it asks first.
      expect(mocks.confirm.mock.calls[0]![0].title).toBe(
        "Replace what's written?",
      );
      expect(mocks.useDraft).toHaveBeenCalledWith({
        id: "m-1",
        expectedUpdatedAt: "2026-11-10T03:00:00.000Z",
      });
    });

    it("loads the minutes when a draft lands in them", async () => {
      mocks.draft.current = { ...NO_DRAFT, status: "drafting", notes: "notes" };
      const draft = ownDraft();
      loaded(draft);
      mocks.refetch.mockResolvedValue({ data: draft });
      const view = render(<MinutesPage id="m-1" />);
      expect(mocks.refetch).not.toHaveBeenCalled();
      mocks.draft.current = { ...NO_DRAFT, status: "applied", notes: "notes" };
      view.rerender(<MinutesPage id="m-1" />);
      await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1));
    });

    it("clears stored notes only after asking", async () => {
      mocks.draft.current = { ...NO_DRAFT, status: "applied", notes: "notes" };
      loaded(ownDraft());
      mocks.confirm.mockResolvedValueOnce(null);
      render(<MinutesPage id="m-1" />);
      fireEvent.click(screen.getByRole("button", { name: "Clear notes" }));
      await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
      expect(mocks.discardDraft).not.toHaveBeenCalled();
      mocks.confirm.mockResolvedValueOnce({ comment: "" });
      mocks.discardDraft.mockResolvedValue("m-1");
      fireEvent.click(screen.getByRole("button", { name: "Clear notes" }));
      await waitFor(() =>
        expect(mocks.discardDraft).toHaveBeenCalledWith({ id: "m-1" }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("textbox", { name: "Your notes" }),
        ).toHaveProperty("value", ""),
      );
    });

    it("tells the officer when someone saved before the draft could start", async () => {
      mocks.draft.current = NO_DRAFT;
      const draft = ownDraft();
      loaded(draft);
      mocks.refetch.mockResolvedValue({ data: draft });
      mocks.requestDraft.mockRejectedValue({ code: "meeting.stale" });
      render(<MinutesPage id="m-1" />);
      fireEvent.change(screen.getByRole("textbox", { name: "Your notes" }), {
        target: { value: "notes" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Draft minutes" }));
      expect(
        await screen.findByText(/Someone else saved these minutes/),
      ).toBeTruthy();
    });

    it("opens the AI sheet on the first ask, and drafts nothing on a No", async () => {
      mocks.draft.current = { ...NO_DRAFT, blocked: "consent_required" };
      loaded(ownDraft());
      mocks.refetch.mockResolvedValue({ data: ownDraft() });
      mocks.ensureConsent.mockResolvedValueOnce(false);
      mocks.requestDraft.mockResolvedValue({ ...NO_DRAFT, status: "drafting" });
      render(<MinutesPage id="m-1" />);
      expect(screen.getByText(/you haven't agreed to that yet/)).toBeTruthy();
      fireEvent.change(screen.getByRole("textbox", { name: "Your notes" }), {
        target: { value: "notes" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Draft minutes" }));
      await waitFor(() => expect(mocks.ensureConsent).toHaveBeenCalledTimes(1));
      expect(mocks.requestDraft).not.toHaveBeenCalled();
      expect(
        screen.getByRole("textbox", { name: "Your notes" }),
      ).toHaveProperty("value", "notes");
      mocks.ensureConsent.mockResolvedValueOnce(true);
      fireEvent.click(screen.getByRole("button", { name: "Draft minutes" }));
      await waitFor(() => expect(mocks.requestDraft).toHaveBeenCalledTimes(1));
    });

    it("says plainly when a draft failed, and keeps the notes", () => {
      loaded(ownDraft());
      const first = render(<div />);
      first.unmount();

      mocks.draft.current = {
        ...NO_DRAFT,
        status: "failed",
        notes: "notes",
        failure: "failed",
        failure_message: "The draft didn't come through.",
      };
      render(<MinutesPage id="m-1" />);
      expect(screen.getByText("The draft didn't come through.")).toBeTruthy();
      expect(
        screen.getByRole("textbox", { name: "Your notes" }),
      ).toHaveProperty("value", "notes");
    });
  });
});
