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
  MEETING_RECORDER_COPY,
} from "@repo/validation";
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
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRequestMeetingDraft: () => ({
    mutateAsync: hooks.request,
    isPending: false,
  }),
  useDiscardMeetingDraft: () => ({
    mutateAsync: hooks.discard,
    isPending: false,
  }),
  useUseMeetingDraft: () => ({ mutateAsync: hooks.use, isPending: false }),
  useRemoveMeetingRecording: () => ({
    mutateAsync: hooks.removeRecording,
    isPending: false,
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

import { NotesDraftSheet } from "./notes-draft-sheet";

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
      <NotesDraftSheet
        ref={React.createRef<never>()}
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
    (node) => (node.type as unknown) === "BottomSheetTextInput",
  )[0];
const press = (tree: ReactTestRenderer, label: string) =>
  act(async () => button(tree, label).props.onPress());

beforeEach(() => {
  vi.clearAllMocks();
  getVersion.mockResolvedValue("v1");
  hooks.request.mockResolvedValue({});
  hooks.discard.mockResolvedValue({});
  hooks.use.mockResolvedValue({});
  hooks.removeRecording.mockResolvedValue({});
  gate.ensureConsent.mockResolvedValue(true);
  confirm.mockResolvedValue(true);
  reporting.offered = true;
  reporting.reported = false;
});

describe("a recording's transcript in the notes", () => {
  it("goes into an empty box by itself, so Open your notes finds it there", () => {
    const tree = render(draftState(), false, recordingState());
    expect(field(tree).props.value).toBe(
      "Speaker 1: Call to order.\nSpeaker 2: Budget passed.",
    );
    expect(button(tree, MEETING_RECORDER_COPY.addTranscript)).toBeUndefined();
  });

  it("arrives while the sheet is already mounted, when transcription finishes", () => {
    const tree = render(
      draftState(),
      false,
      recordingState({ status: "transcribing", transcript: null }),
    );
    expect(field(tree).props.value).toBe("");
    act(() => tree.update(element(draftState(), false, recordingState())));
    expect(field(tree).props.value).toContain("Call to order");
  });

  it("waits behind a button when the officer already typed notes, and is added under them", async () => {
    const tree = render(
      draftState({ notes: "My own notes." }),
      false,
      recordingState(),
    );
    expect(field(tree).props.value).toBe("My own notes.");
    await press(tree, MEETING_RECORDER_COPY.addTranscript);
    expect(field(tree).props.value).toBe(
      "My own notes.\n\nSpeaker 1: Call to order.\nSpeaker 2: Budget passed.",
    );
    expect(button(tree, MEETING_RECORDER_COPY.addTranscript)).toBeUndefined();
  });

  it("is put in once per recording: a box emptied by hand stays emptied", () => {
    const tree = render(draftState(), false, recordingState());
    act(() => field(tree).props.onChangeText(""));
    act(() => tree.update(element(draftState(), false, recordingState())));
    expect(field(tree).props.value).toBe("");
    // A new recording is a new transcript to put in.
    act(() =>
      tree.update(
        element(
          draftState(),
          false,
          recordingState({ upload_id: "upload-2", transcript: "Speaker 1: Round two." }),
        ),
      ),
    );
    expect(field(tree).props.value).toBe("Speaker 1: Round two.");
  });

  it("is removed with the notes when they are cleared, and the question says so", async () => {
    const tree = render(draftState(), false, recordingState());
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

describe("NotesDraftSheet", () => {
  it("checks the notes when Draft is pressed, not while they are typed", async () => {
    const tree = render(draftState());
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.idle);
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.empty);
    expect(hooks.request).not.toHaveBeenCalled();

    const long = "x".repeat(MEETING_NOTES_MAX_LENGTH + 1);
    act(() => field(tree).props.onChangeText(long));
    // Typing clears the last problem and raises none of its own.
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.idle);
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(screenText(tree)).toContain(
      MEETING_NOTES_COPY.tooLong(MEETING_NOTES_MAX_LENGTH, long.length),
    );
    expect(hooks.request).not.toHaveBeenCalled();
  });

  it("sends the notes against the version read just now, with the meeting's local day", async () => {
    const tree = render(draftState());
    act(() => field(tree).props.onChangeText("  Budget passed 12-3.  "));
    await press(tree, MEETING_NOTES_COPY.draft);
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
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(gate.ensureConsent).toHaveBeenCalledTimes(1);
    expect(hooks.request).not.toHaveBeenCalled();
    expect(field(tree).props.value).toBe("Notes");
  });

  it("stops saying consent is missing once the member has said yes", async () => {
    confirm.mockResolvedValue(false);
    const tree = render(draftState({ blocked: "consent_required" } as never), true);
    act(() => field(tree).props.onChangeText("Notes"));
    // Yes on the sheet, then Cancel on "replace what's written?".
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(screenText(tree)).not.toContain(
      MEETING_DRAFT_FAILURE_COPY.consent_required,
    );
    // And the next press doesn't ask again.
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(gate.ensureConsent).toHaveBeenCalledTimes(1);
  });

  it("asks on the next press after the server says consent is missing", async () => {
    hooks.request.mockRejectedValueOnce({ code: "ai.consent.required" });
    const tree = render(draftState());
    act(() => field(tree).props.onChangeText("Notes"));
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(gate.ensureConsent).not.toHaveBeenCalled();
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(gate.ensureConsent).toHaveBeenCalledTimes(1);
    expect(hooks.request).toHaveBeenCalledTimes(2);
  });

  it("says it couldn't check consent rather than treating a failed read as No", async () => {
    gate.ensureConsent.mockRejectedValue(new Error("offline"));
    const tree = render(draftState({ blocked: "consent_required" } as never));
    act(() => field(tree).props.onChangeText("Notes"));
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(screenText(tree)).toContain(MEETING_NOTES_COPY.consentCheckFailed);
  });

  it("asks before a draft replaces what the minutes hold", async () => {
    confirm.mockResolvedValue(false);
    const tree = render(draftState(), true);
    act(() => field(tree).props.onChangeText("Notes"));
    await press(tree, MEETING_NOTES_COPY.draft);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: MEETING_NOTES_COPY.replaceTitle }),
    );
    expect(hooks.request).not.toHaveBeenCalled();
  });

  it("doesn't draft on a guess when the minutes' version can't be read", async () => {
    getVersion.mockResolvedValue(null);
    const tree = render(draftState());
    act(() => field(tree).props.onChangeText("Notes"));
    await press(tree, MEETING_NOTES_COPY.draft);
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
