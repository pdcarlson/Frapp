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
  recording: { current: null as unknown },
  startRecording: vi.fn(),
  confirmRecording: vi.fn(),
  removeRecording: vi.fn(),
  uploadResumable: vi.fn(),
  readAudioDuration: vi.fn(),
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
  useMeetingRecording: () => ({
    isPending: false,
    data: mocks.recording.current,
  }),
  useStartMeetingRecording: () => ({
    mutateAsync: mocks.startRecording,
    isPending: false,
  }),
  useConfirmMeetingRecording: () => ({
    mutateAsync: mocks.confirmRecording,
    isPending: false,
  }),
  useRemoveMeetingRecording: () => ({
    mutateAsync: mocks.removeRecording,
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

vi.mock("@/components/ai/ai-consent-sheet", () => ({
  useAiConsentGate: () => ({
    ensureConsent: mocks.ensureConsent,
    consentDialog: null,
  }),
}));

vi.mock("@/lib/resumable-upload", () => ({
  ResumableUploadError: class extends Error {
    constructor(readonly failure: string) {
      super(failure);
    }
  },
  uploadResumable: mocks.uploadResumable,
  readAudioDuration: mocks.readAudioDuration,
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
    mocks.startRecording,
    mocks.confirmRecording,
    mocks.removeRecording,
    mocks.uploadResumable,
    mocks.readAudioDuration,
  ]) {
    fn.mockReset();
  }
  mocks.draft.current = null;
  mocks.recording.current = null;
});

const NO_RECORDING = {
  status: "none",
  upload_id: null,
  file_name: null,
  size_bytes: null,
  duration_seconds: null,
  failure: null,
  failure_message: null,
  transcript: null,
  speaker_count: null,
  uploaded_at: null,
  available: true,
  blocked: null,
  max_bytes: 200 * 1024 * 1024,
  max_seconds: 7200,
  upload: null,
};

const TRANSCRIPT =
  "Speaker 1: Call to order.\nSpeaker 2: Treasurer report.";

const READY_RECORDING = {
  ...NO_RECORDING,
  status: "ready",
  upload_id: "u-1",
  file_name: "chapter.m4a",
  size_bytes: 60_000_000,
  duration_seconds: 4320,
  transcript: TRANSCRIPT,
  speaker_count: 2,
};

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

  describe("uploading a recording", () => {
    const notesBox = () => screen.getByRole("textbox", { name: "Your notes" });
    const recordingFile = () =>
      new File(["audio"], "chapter.m4a", { type: "audio/x-m4a" });

    function open() {
      mocks.draft.current = NO_DRAFT;
      loaded(ownDraft());
      render(<MinutesPage id="m-1" />);
    }

    it("offers no upload where this server transcribes nothing", () => {
      mocks.recording.current = null;
      open();
      expect(
        screen.queryByRole("button", { name: "Upload a recording" }),
      ).toBeNull();
      expect(notesBox()).toBeTruthy();
    });

    it("offers none when no provider is set up", () => {
      mocks.recording.current = { ...NO_RECORDING, available: false };
      open();
      expect(
        screen.queryByRole("button", { name: "Upload a recording" }),
      ).toBeNull();
    });

    it("won't upload until a file is chosen and the room is confirmed told, then sends it and asks for the transcript", async () => {
      mocks.recording.current = NO_RECORDING;
      mocks.readAudioDuration.mockResolvedValue(4320.4);
      mocks.startRecording.mockResolvedValue({
        ...NO_RECORDING,
        status: "uploading",
        upload: {
          upload_id: "u-1",
          bucket: "meeting-audio",
          path: "c/m/u-1.m4a",
          token: "signed",
          content_type: "audio/x-m4a",
        },
      });
      mocks.uploadResumable.mockResolvedValue(undefined);
      mocks.confirmRecording.mockResolvedValue({});
      open();
      fireEvent.click(
        screen.getByRole("button", { name: "Upload a recording" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(dialog.textContent).toContain(
        "This meeting is being recorded and transcribed by Frapp.",
      );
      expect(dialog.textContent).toContain("Never upload a Standards hearing");

      fireEvent.click(screen.getByRole("button", { name: "Upload" }));
      expect(screen.getByText("Choose the recording first.")).toBeTruthy();

      const input = dialog.querySelector('input[type="file"]')!;
      fireEvent.change(input, { target: { files: [recordingFile()] } });
      expect(
        await screen.findByText(/chapter\.m4a · 1 hour 12 minutes/),
      ).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Upload" }));
      expect(
        screen.getByText(/Confirm that the room was told/),
      ).toBeTruthy();
      expect(mocks.startRecording).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Upload" }));
      await waitFor(() =>
        expect(mocks.confirmRecording).toHaveBeenCalledWith({
          id: "m-1",
          uploadId: "u-1",
        }),
      );
      expect(mocks.startRecording.mock.calls[0]![0]).toEqual({
        id: "m-1",
        body: {
          file_name: "chapter.m4a",
          mime_type: "audio/x-m4a",
          size_bytes: 5,
          duration_seconds: 4320,
          notice_confirmed: true,
        },
      });
      expect(mocks.uploadResumable.mock.calls[0]![1]).toEqual({
        bucket: "meeting-audio",
        path: "c/m/u-1.m4a",
        token: "signed",
        contentType: "audio/x-m4a",
      });
    });

    it.each([
      [new File(["x"], "meeting.mov", { type: "video/quicktime" }), 60, /isn't a recording Frapp can read/],
      [new File(["x"], "long.m4a", { type: "audio/mp4" }), 7300, /the most Frapp takes is 2 hours/],
      [new File(["x"], "odd.ogg", { type: "audio/ogg" }), null, /couldn't read how long/],
    ])("says what is wrong with a file the moment it is chosen", async (file, seconds, message) => {
      mocks.recording.current = NO_RECORDING;
      mocks.readAudioDuration.mockResolvedValue(seconds);
      open();
      fireEvent.click(
        screen.getByRole("button", { name: "Upload a recording" }),
      );
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(dialog.querySelector('input[type="file"]')!, {
        target: { files: [file] },
      });
      expect(await screen.findByText(message)).toBeTruthy();
    });

    it("asks on the AI sheet first, and opens nothing on a No", async () => {
      mocks.recording.current = {
        ...NO_RECORDING,
        blocked: "consent_required",
      };
      mocks.ensureConsent.mockResolvedValue(false);
      open();
      fireEvent.click(
        screen.getByRole("button", { name: "Upload a recording" }),
      );
      await waitFor(() => expect(mocks.ensureConsent).toHaveBeenCalled());
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("says an upload is transcribing after a reload, and that the page can be left", () => {
      mocks.recording.current = {
        ...NO_RECORDING,
        status: "transcribing",
        upload_id: "u-1",
        duration_seconds: 4320,
      };
      open();
      expect(
        screen.getByText(
          /Transcribing 1 hour 12 minutes of audio\. This takes a few minutes, and you can leave this page\./,
        ),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    });

    it("says an upload cut off by a reload has to be sent again", () => {
      mocks.recording.current = {
        ...NO_RECORDING,
        status: "uploading",
        upload_id: "u-1",
      };
      open();
      expect(screen.getByText(/upload was interrupted/)).toBeTruthy();
    });

    it("shows a failure in plain words with a way to try again", () => {
      mocks.recording.current = {
        ...NO_RECORDING,
        status: "failed",
        failure: "no_speech",
        failure_message: "No speech could be heard in that recording.",
      };
      open();
      expect(
        screen.getByText("No speech could be heard in that recording."),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Upload a recording" }),
      ).toBeTruthy();
    });

    it("puts a transcript that arrives into empty notes by itself", async () => {
      mocks.recording.current = {
        ...NO_RECORDING,
        status: "transcribing",
        upload_id: "u-1",
        duration_seconds: 4320,
      };
      mocks.draft.current = NO_DRAFT;
      loaded(ownDraft());
      const view = render(<MinutesPage id="m-1" />);
      mocks.recording.current = READY_RECORDING;
      view.rerender(<MinutesPage id="m-1" />);
      await waitFor(() =>
        expect(notesBox()).toHaveProperty("value", TRANSCRIPT),
      );
      expect(
        screen.getByText(
          /The transcript is in your notes \(1 hour 12 minutes, 2 speakers\)/,
        ),
      ).toBeTruthy();
    });

    it("never writes over notes already typed: the transcript waits to be added below them", async () => {
      mocks.recording.current = READY_RECORDING;
      mocks.draft.current = { ...NO_DRAFT, notes: "my own notes" };
      loaded(ownDraft());
      render(<MinutesPage id="m-1" />);
      expect(notesBox()).toHaveProperty("value", "my own notes");
      fireEvent.click(
        screen.getByRole("button", { name: "Add to your notes" }),
      );
      await waitFor(() =>
        expect(notesBox()).toHaveProperty(
          "value",
          `my own notes\n\n${TRANSCRIPT}`,
        ),
      );
    });

    it("clearing the notes removes the recording and its transcript too", async () => {
      mocks.recording.current = READY_RECORDING;
      mocks.confirm.mockResolvedValue({});
      mocks.removeRecording.mockResolvedValue("m-1");
      open();
      fireEvent.click(screen.getByRole("button", { name: "Clear notes" }));
      await waitFor(() =>
        expect(mocks.removeRecording).toHaveBeenCalledWith({ id: "m-1" }),
      );
      expect(mocks.confirm.mock.calls[0]![0].description).toContain(
        "the recording and its transcript",
      );
    });
  });
});
