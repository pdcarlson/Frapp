/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingDraftState, MeetingRecordingState } from "@repo/hooks";
import {
  AI_REPORT_COPY,
  MEETING_DRAFT_FAILURE_COPY,
  MEETING_NOTES_COPY,
  MEETING_NOTES_MAX_LENGTH,
  MEETING_NOTE_TAKERS_COPY,
} from "@repo/validation";
import { dropAllKeptDrafts } from "@repo/hooks/kept-drafts";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * Drafting minutes from pasted notes on the phone (#4312). Nothing is sent
 * until the officer has said yes to AI, and a draft never replaces what the
 * minutes hold without asking.
 */
const hooks = vi.hoisted(() => ({
  request: vi.fn(),
  discard: vi.fn(),
  use: vi.fn(),
  removeRecording: vi.fn(),
  choose: vi.fn(),
  saveNotes: vi.fn(),
  notesState: null as unknown,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRequestMeetingDraft: () => ({
    mutateAsync: hooks.request,
    isPending: false,
  }),
  useSaveMeetingNotes: () => ({ mutate: hooks.saveNotes, isPending: false }),
  useDiscardMeetingDraft: () => ({
    mutateAsync: hooks.discard,
    isPending: false,
  }),
  useUseMeetingDraft: () => ({ mutateAsync: hooks.use, isPending: false }),
  useRemoveMeetingRecording: () => ({
    mutateAsync: hooks.removeRecording,
    isPending: false,
  }),
  useMeetingNotes: () => ({ data: hooks.notesState }),
  useChooseMeetingDraftVersion: () => ({
    mutateAsync: hooks.choose,
    isPending: false,
  }),
  useCurrentUser: () => ({ data: { id: "u-me" } }),
  useMemberDisplayNames: () => ({
    nameFor: (id: string) => (id === "u-me" ? "Eli Sorensen" : null),
  }),
}));
const gate = vi.hoisted(() => ({ ensureConsent: vi.fn() }));
vi.mock("@/components/ai/meet-frapp-ai", () => ({
  useAiConsentGate: () => ({
    ensureConsent: gate.ensureConsent,
    consentSheet: null,
  }),
}));
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/lib/minutes/meetings-on", () => ({ confirmAlert: confirm }));
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

import { NotesPanel, type NotesPanelHandle } from "./notes-panel";

let panel = React.createRef<NotesPanelHandle>();

function draftState(over: Partial<MeetingDraftState> = {}): MeetingDraftState {
  return {
    status: "none",
    notes: "",
    blocked: null,
    failure: null,
    failure_message: null,
    review: { gaps: [], left_out: [] },
    ...over,
  } as MeetingDraftState;
}

const getVersion = vi.fn();
const onSettled = vi.fn();

function recordingState(
  over: Partial<MeetingRecordingState> = {},
): MeetingRecordingState {
  return {
    status: "ready",
    upload_id: "upload-1",
    transcript: "Speaker 1: Call to order.\nSpeaker 2: Budget passed.",
    duration_seconds: 3600,
    ...over,
  } as MeetingRecordingState;
}

function element(
  state: MeetingDraftState,
  hasContent = false,
  recording: MeetingRecordingState | null = null,
) {
  return (
    <FrappThemeProvider>
      <NotesPanel
        ref={panel}
        meetingId="m1"
        eventStart="2026-11-09T23:00:00Z"
        state={state}
        hasContent={hasContent}
        recording={recording}
        getVersion={getVersion}
        onSettled={onSettled}
      />
    </FrappThemeProvider>
  );
}
function render(
  state: MeetingDraftState,
  hasContent = false,
  recording: MeetingRecordingState | null = null,
) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element(state, hasContent, recording));
  });
  return tree;
}
const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      typeof node.props.onPress === "function" &&
      (node.props.accessibilityLabel === label || drawnText(node) === label),
  )[0];
const field = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) => (node.type as unknown) === "TextInput",
  )[0];
const press = (tree: ReactTestRenderer, label: string) =>
  act(async () => button(tree, label).props.onPress());
/** Draft minutes sits in the screen's pinned footer, which calls the panel. */
const draft = () =>
  act(async () => {
    void panel.current?.draft();
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Typed notes outlive the sheet (#5041); each spec starts with none kept.
  dropAllKeptDrafts();
  panel = React.createRef<NotesPanelHandle>();
  getVersion.mockResolvedValue("v1");
  hooks.request.mockResolvedValue({});
  hooks.discard.mockResolvedValue({});
  hooks.use.mockResolvedValue({});
  hooks.removeRecording.mockResolvedValue({});
  hooks.choose.mockResolvedValue({});
  hooks.notesState = null;
  gate.ensureConsent.mockResolvedValue(true);
  confirm.mockResolvedValue(true);
  reporting.offered = true;
  reporting.reported = false;
});

describe("a recording's transcript, a source of its own (#4935)", () => {
  it("is read by the draft beside the notes, never put into the box", () => {
    const tree = render(draftState(), false, recordingState());
    expect(field(tree).props.value).toBe("");
  });

  it("drafts with no notes of the officer's own when the recording is ready", async () => {
    render(draftState(), false, recordingState());
    await draft();
    expect(hooks.request).toHaveBeenCalledWith({
      id: "m1",
      body: expect.not.objectContaining({ notes: expect.anything() }),
    });
  });

  it("is removed with the notes when they are cleared, and the question says so", async () => {
    const tree = render(
      draftState({ notes: "Typed." }),
      false,
      recordingState(),
    );
    await press(tree, MEETING_NOTES_COPY.clear);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ body: MEETING_NOTES_COPY.clearBodyRecording }),
    );
    expect(hooks.removeRecording).toHaveBeenCalledWith({ id: "m1" });
    expect(field(tree).props.value).toBe("");
  });

  it("removes no recording when there is none", async () => {
    const tree = render(draftState({ notes: "Typed." }));
    await press(tree, MEETING_NOTES_COPY.clear);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ body: MEETING_NOTES_COPY.clearBody }),
    );
    expect(hooks.removeRecording).not.toHaveBeenCalled();
  });
});

describe("Notes disagreed (#4935)", () => {
  it("lists a disagreement and puts the other version in on a tap", async () => {
    const tree = render(
      draftState({
        status: "applied",
        notes: "Typed.",
        review: {
          gaps: [],
          sources: [],
          left_out: 0,
          conflicts: [
            {
              kind: "decision",
              about: "The formal budget vote",
              versions: [
                {
                  from: "Eli Sorensen",
                  quote: "budget passed 22-5",
                  text: "Approved the budget, 22 to 5.",
                  vote: { for: 22, against: 5, abstain: 0 },
                  owner_user_id: null,
                  due_date: null,
                },
                {
                  from: "Sam Lee",
                  quote: "budget passed 21-6",
                  text: "Approved the budget, 21 to 6.",
                  vote: { for: 21, against: 6, abstain: 0 },
                  owner_user_id: null,
                  due_date: null,
                },
              ],
              chosen: 0,
              settled_by: "authority",
            },
          ],
        },
      }),
    );
    expect(
      button(tree, MEETING_NOTE_TAKERS_COPY.takeVersion("Sam Lee")),
    ).toBeDefined();
    await press(tree, MEETING_NOTE_TAKERS_COPY.takeVersion("Sam Lee"));
    expect(hooks.choose).toHaveBeenCalledWith({
      id: "m1",
      body: { conflict: 0, version: 1, expected_updated_at: "v1" },
    });
  });
});

describe("NotesPanel", () => {
  it("checks the notes when Draft is pressed, not while they are typed", async () => {
    const tree = render(draftState());
    await draft();
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.empty);
    expect(hooks.request).not.toHaveBeenCalled();

    const long = "x".repeat(MEETING_NOTES_MAX_LENGTH + 1);
    act(() => field(tree).props.onChangeText(long));
    // Typing clears the last problem and raises none of its own.
    await draft();
    expect(screenText(tree)).toContain(
      MEETING_NOTES_COPY.tooLong(MEETING_NOTES_MAX_LENGTH, long.length),
    );
    expect(hooks.request).not.toHaveBeenCalled();
  });

  it("saves the notes as they type, once typing rests (#5288)", () => {
    vi.useFakeTimers();
    try {
      const tree = render(draftState());
      act(() => field(tree).props.onChangeText("Budget passed"));
      act(() => vi.advanceTimersByTime(600));
      act(() => field(tree).props.onChangeText("Budget passed 12-3.  "));
      act(() => vi.advanceTimersByTime(1199));
      expect(hooks.saveNotes).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      // Once, with what rests, trimmed at the end as the server stores it.
      expect(hooks.saveNotes).toHaveBeenCalledTimes(1);
      expect(hooks.saveNotes).toHaveBeenCalledWith(
        { id: "m1", notes: "Budget passed 12-3." },
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("never saves an emptied box by itself: that would clear the draft written from it", () => {
    vi.useFakeTimers();
    try {
      const tree = render(draftState({ notes: "Typed." }));
      act(() => field(tree).props.onChangeText("   "));
      act(() => vi.advanceTimersByTime(5000));
      expect(hooks.saveNotes).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends the notes against the version read just now, with the meeting's local day", async () => {
    const tree = render(draftState());
    act(() => field(tree).props.onChangeText("  Budget passed 12-3.  "));
    await draft();
    expect(confirm).not.toHaveBeenCalled();
    expect(hooks.request).toHaveBeenCalledWith({
      id: "m1",
      body: {
        notes: "Budget passed 12-3.",
        expected_updated_at: "v1",
        meeting_date: expect.stringMatching(/^2026-11-(09|10)$/),
      },
    });
  });

  it("asks for AI consent first, and a No sends nothing and keeps the notes", async () => {
    gate.ensureConsent.mockResolvedValue(false);
    const tree = render(draftState({ blocked: "consent_required" } as never));
    expect(screenText(tree)).toContain(
      MEETING_DRAFT_FAILURE_COPY.consent_required,
    );
    act(() => field(tree).props.onChangeText("Notes"));
    await draft();
    expect(gate.ensureConsent).toHaveBeenCalledTimes(1);
    expect(hooks.request).not.toHaveBeenCalled();
    expect(field(tree).props.value).toBe("Notes");
  });

  it("stops saying consent is missing once the member has said yes", async () => {
    confirm.mockResolvedValue(false);
    const tree = render(
      draftState({ blocked: "consent_required" } as never),
      true,
    );
    act(() => field(tree).props.onChangeText("Notes"));
    // Yes on the sheet, then Cancel on "replace what's written?".
    await draft();
    expect(screenText(tree)).not.toContain(
      MEETING_DRAFT_FAILURE_COPY.consent_required,
    );
    // And the next press doesn't ask again.
    await draft();
    expect(gate.ensureConsent).toHaveBeenCalledTimes(1);
  });

  it("asks on the next press after the server says consent is missing", async () => {
    hooks.request.mockRejectedValueOnce({ code: "ai.consent.required" });
    const tree = render(draftState());
    act(() => field(tree).props.onChangeText("Notes"));
    await draft();
    expect(gate.ensureConsent).not.toHaveBeenCalled();
    await draft();
    expect(gate.ensureConsent).toHaveBeenCalledTimes(1);
    expect(hooks.request).toHaveBeenCalledTimes(2);
  });

  it("says it couldn't check consent rather than treating a failed read as No", async () => {
    gate.ensureConsent.mockRejectedValue(new Error("offline"));
    const tree = render(draftState({ blocked: "consent_required" } as never));
    act(() => field(tree).props.onChangeText("Notes"));
    await draft();
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.consentCheckFailed);
  });

  it("asks before a draft replaces what the minutes hold", async () => {
    confirm.mockResolvedValue(false);
    const tree = render(draftState(), true);
    act(() => field(tree).props.onChangeText("Notes"));
    await draft();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: MEETING_NOTES_COPY.replaceTitle }),
    );
    expect(hooks.request).not.toHaveBeenCalled();
  });

  it("doesn't draft on a guess when the minutes' version can't be read", async () => {
    getVersion.mockResolvedValue(null);
    const tree = render(draftState());
    act(() => field(tree).props.onChangeText("Notes"));
    await draft();
    expect(hooks.request).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.startFailed);
  });

  it("locks the notes while a draft is written, and Stop keeps them", async () => {
    const tree = render(draftState({ status: "drafting", notes: "Notes" }));
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.drafting);
    expect(field(tree).props.editable).toBe(false);
    await press(tree, MEETING_NOTES_COPY.stop);
    expect(hooks.discard).toHaveBeenCalledWith({ id: "m1", keepNotes: true });
  });

  it("puts a waiting draft in on Use draft, against the fresh version", async () => {
    const tree = render(draftState({ status: "ready", notes: "Notes" }));
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.waiting);
    await press(tree, MEETING_NOTES_COPY.useDraft);
    expect(hooks.use).toHaveBeenCalledWith({
      id: "m1",
      expectedUpdatedAt: "v1",
    });
  });

  it("tells the minutes behind it to read again once a draft stops being written", () => {
    const tree = render(draftState({ status: "drafting", notes: "Notes" }));
    expect(onSettled).not.toHaveBeenCalled();
    act(() => tree.update(element(draftState({ status: "applied" }))));
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("lets a written draft be reported, each draft as its own thing", async () => {
    const tree = render(
      draftState({
        status: "ready",
        notes: "n",
        requested_at: "2026-11-12T01:00:00Z",
      } as Partial<MeetingDraftState>),
    );
    await press(tree, AI_REPORT_COPY.titles.meeting_draft);
    expect(reporting.report).toHaveBeenCalledWith({
      subject: "meeting_draft",
      subjectId: "m1",
      version: "2026-11-12T01:00:00Z",
    });
  });

  it("offers no report before there is a draft, while one is written, or without ai:use", () => {
    expect(
      button(render(draftState()), AI_REPORT_COPY.titles.meeting_draft),
    ).toBeUndefined();
    expect(
      button(
        render(draftState({ status: "drafting", notes: "n" })),
        AI_REPORT_COPY.titles.meeting_draft,
      ),
    ).toBeUndefined();
    reporting.offered = false;
    expect(
      button(
        render(draftState({ status: "ready", notes: "n" })),
        AI_REPORT_COPY.titles.meeting_draft,
      ),
    ).toBeUndefined();
  });

  it("reads Reported, and can't be pressed again, once a draft is reported", () => {
    reporting.reported = true;
    const tree = render(draftState({ status: "applied", notes: "n" }));
    expect(screenText(tree)).toContain(AI_REPORT_COPY.reported);
    expect(button(tree, AI_REPORT_COPY.reported).props.disabled).toBe(true);
  });

  it("says why a draft failed in the server's words", () => {
    const tree = render(
      draftState({
        status: "failed",
        failure: "over_cap",
        failure_message: "Your chapter has used this month's AI allowance.",
      } as never),
    );
    expect(screenText(tree)).toContain(
      "Your chapter has used this month's AI allowance.",
    );
  });
});

/**
 * Notes are stored only once a draft is asked for, so what was typed before
 * then outlives the minutes screen (#5041): a back swipe used to lose it.
 */
describe("NotesPanel's kept notes (#5041)", () => {
  const type = (tree: ReactTestRenderer, text: string) =>
    act(() => field(tree).props.onChangeText(text));
  const leave = (tree: ReactTestRenderer) => act(() => tree.unmount());

  it("keeps typed notes for the meeting's next visit, over the stored ones", () => {
    const first = render(draftState({ notes: "Old notes." }));
    type(first, "Old notes. Budget passed 12-3.");
    leave(first);
    const second = render(draftState({ notes: "Old notes." }));
    expect(field(second).props.value).toBe("Old notes. Budget passed 12-3.");
    leave(second);
  });

  it("keeps nothing for a sheet opened and left untouched", () => {
    leave(render(draftState({ notes: "Old notes." })));
    const second = render(draftState({ notes: "Newer, from the web." }));
    expect(field(second).props.value).toBe("Newer, from the web.");
    leave(second);
  });

  it("gives them up once the draft is asked for, and keeps what is typed after", async () => {
    const first = render(draftState());
    type(first, "Budget passed.");
    await draft();
    expect(hooks.request).toHaveBeenCalled();
    leave(first);
    // The server holds them now, and a later visit opens on them.
    const stored = render(draftState({ notes: "Budget passed, revised." }));
    expect(field(stored).props.value).toBe("Budget passed, revised.");
    leave(stored);
  });

  it("keeps what is typed in the same visit after the ask lands", async () => {
    const first = render(draftState());
    type(first, "Budget passed.");
    await draft();
    type(first, "Budget passed. Social on Friday.");
    leave(first);
    const second = render(draftState({ notes: "Budget passed." }));
    expect(field(second).props.value).toBe("Budget passed. Social on Friday.");
    leave(second);
  });

  it("reopens mid-ask on the notes it sent, held until the ask settles (#5086)", async () => {
    hooks.request.mockReturnValueOnce(new Promise(() => {}));
    const first = render(draftState());
    type(first, "Budget passed.");
    await draft();
    leave(first);
    const calls = hooks.request.mock.calls.length;

    const during = render(draftState());
    expect(field(during).props.value).toBe("Budget passed.");
    expect(field(during).props.editable).toBe(false);
    // Nothing offers the same ask again while the first is out.
    expect(screenText(during)).not.toContain(MEETING_NOTES_COPY.draftAgain);
    expect(hooks.request.mock.calls.length).toBe(calls);
    leave(during);
  });

  it("keeps what a reopened sheet shows when the ask fails, through an edit (#5086)", async () => {
    let fail: (error: unknown) => void = () => {};
    hooks.request.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const first = render(draftState());
    type(first, "Budget passed.");
    await draft();
    leave(first);
    const during = render(draftState());

    await act(async () => fail(new Error("offline")));
    expect(field(during).props.editable).toBe(true);
    expect(field(during).props.value).toBe("Budget passed.");
    type(during, "Budget passed. Dues next.");
    leave(during);

    const after = render(draftState());
    expect(field(after).props.value).toBe("Budget passed. Dues next.");
    leave(after);
  });

  it("keeps them when the ask fails with no sheet open", async () => {
    let fail: (error: unknown) => void = () => {};
    hooks.request.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const first = render(draftState());
    type(first, "Budget passed.");
    await draft();
    leave(first);

    await act(async () => fail(new Error("offline")));
    const after = render(draftState());
    expect(field(after).props.value).toBe("Budget passed.");
    leave(after);
  });

  it("keeps nothing once the ask a reopened sheet waited on lands (#5086)", async () => {
    let land: () => void = () => {};
    hooks.request.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        land = resolve;
      }),
    );
    const first = render(draftState());
    // A trailing newline, as a multiline box often has: the server stores
    // the notes trimmed.
    type(first, "Budget passed.\n");
    await draft();
    leave(first);
    const during = render(draftState());

    await act(async () => land());
    expect(field(during).props.editable).toBe(true);
    // What is typed after the landing is over the notes the server holds.
    type(during, "Budget passed. Dues next.");
    leave(during);

    const after = render(draftState({ notes: "Budget passed." }));
    expect(field(after).props.value).toBe("Budget passed. Dues next.");
    leave(after);
  });

  it("gives them up on Clear, so a later visit opens on the stored notes", async () => {
    const first = render(draftState({ status: "ready", notes: "Old." }));
    type(first, "Old. Budget passed.");
    await press(first, MEETING_NOTES_COPY.clear);
    expect(field(first).props.value).toBe("");
    leave(first);
    // Notes sent from the web since: an emptied box kept here would hide them.
    const second = render(draftState({ notes: "From the web." }));
    expect(field(second).props.value).toBe("From the web.");
    leave(second);
  });

  it("doesn't bring back notes typed over ones the web has replaced since, and drops them", () => {
    const first = render(draftState({ notes: "Old notes." }));
    type(first, "Old notes. Budget passed.");
    leave(first);
    // Someone drafted from other notes on web meanwhile.
    const second = render(draftState({ notes: "From the web." }));
    expect(field(second).props.value).toBe("From the web.");
    leave(second);
    const third = render(draftState({ notes: "Old notes." }));
    expect(field(third).props.value).toBe("Old notes.");
    leave(third);
  });

  it("keeps nothing for a transcript put in by itself, so one cleared on web stays cleared", () => {
    // Mounted with the minutes screen; the transcript fills the empty box.
    leave(render(draftState(), false, recordingState()));
    // The officer cleared the notes and the recording on web.
    const after = render(draftState(), false, null);
    expect(field(after).props.value).toBe("");
    leave(after);
  });
});
