/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import {
  MEETING_COPY,
  MEETING_NOTES_COPY,
  MEETING_RECORDER_COPY,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * Minutes on the phone (#4312): a member reads posted minutes; the officer
 * who may edit a draft drafts it from notes (only where the server offers
 * that) and posts it. Renders `app/(app)/minutes-details.tsx` from here, since
 * a spec under `app/` ships as a route module.
 */
const state = vi.hoisted(() => ({
  meeting: null as Record<string, unknown> | null,
  isPending: false,
  error: null as unknown,
  refetch: vi.fn(),
  surfaces: {
    available: true as boolean | undefined,
    meetingNotes: true,
    ready: true,
  },
  draft: { status: "none" } as Record<string, unknown> | null,
  draftEnabled: undefined as boolean | undefined,
  draftPending: false,
  suggestions: [] as unknown[],
  suggestionsEnabled: undefined as boolean | undefined,
  post: vi.fn(),
  notesSheet: 0,
  recording: null as Record<string, unknown> | null,
  recordingEnabled: undefined as boolean | undefined,
  recordingPending: false,
  recorder: { phase: "idle", refusal: null } as Record<string, unknown>,
  notesProps: null as Record<string, unknown> | null,
  panelDraft: vi.fn(),
  row: null as Record<string, unknown> | null,
  rowArgs: null as Record<string, unknown> | null,
  stage: null as Record<string, unknown> | null,
  controls: 0,
  summaryProps: null as Record<string, unknown> | null,
  summaryFlush: vi.fn(),
  event: undefined as Record<string, unknown> | undefined,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMeeting: () => ({
    data: state.meeting ?? undefined,
    isPending: state.isPending,
    error: state.error,
    isFetching: false,
    refetch: state.refetch,
  }),
  useMeetingDraft: (_id: string, options: { enabled: boolean }) => {
    state.draftEnabled = options.enabled;
    const pending = options.enabled && state.draftPending;
    return {
      data: options.enabled && !pending ? state.draft : undefined,
      isPending: pending,
      refetch: vi.fn(),
    };
  },
  useAiSuggestions: (options: { enabled: boolean }) => {
    state.suggestionsEnabled = options.enabled;
    return {
      data: options.enabled
        ? { items: state.suggestions, has_more: false }
        : undefined,
      refetch: vi.fn(),
    };
  },
  useMeetingRecording: (_id: string, options: { enabled: boolean }) => {
    state.recordingEnabled = options.enabled;
    return {
      data: options.enabled ? (state.recording ?? undefined) : undefined,
      isPending: options.enabled && state.recordingPending,
      refetch: vi.fn(),
    };
  },
  usePostMeeting: () => ({ mutateAsync: state.post, isPending: false }),
  useEvent: () => ({ data: state.event }),
  useMemberDisplayNames: () => ({ nameFor: () => null }),
}));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => state.surfaces,
}));
vi.mock("@/components/screen-shell", () => ({
  ScreenShell: ({
    title,
    children,
    footer,
  }: {
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => React.createElement("ScreenShell", { title }, children, footer),
}));
vi.mock("@/components/pull-to-refresh", () => ({
  useRefetchAll: () => undefined,
}));
vi.mock("@/components/minutes/minutes-body", () => ({
  MinutesBody: () => React.createElement("MinutesBody"),
}));
vi.mock("@/components/minutes/notes-panel", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    NotesPanel: forwardRef(function NotesPanel(
      props: Record<string, unknown>,
      ref: React.Ref<{ draft: () => Promise<void> }>,
    ) {
      useImperativeHandle(ref, () => ({ draft: state.panelDraft }));
      state.notesSheet += 1;
      state.notesProps = props;
      return null;
    }),
  };
});
vi.mock("@/components/minutes/summary-note", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    SummaryNote: forwardRef(function SummaryNote(
      props: Record<string, unknown>,
      ref: React.Ref<{ flush: () => Promise<string | null> }>,
    ) {
      useImperativeHandle(ref, () => ({ flush: state.summaryFlush }));
      state.summaryProps = props;
      return React.createElement("SummaryNote");
    }),
  };
});
vi.mock("@/components/minutes/recorder", () => ({
  useMeetingRecorderRow: (args: Record<string, unknown>) => {
    state.rowArgs = args;
    return state.row;
  },
  RecorderStage: (props: Record<string, unknown>) => {
    state.stage = props;
    return React.createElement("RecorderStage");
  },
  RecorderControls: () => {
    state.controls += 1;
    return React.createElement("RecorderControls");
  },
}));
vi.mock("@/lib/minutes/recorder/session", () => ({
  useMeetingRecorder: () => ({ state: state.recorder, recorder: null }),
}));
vi.mock("@/components/ai/meet-frapp-ai", () => ({
  useAiConsentGate: () => ({
    ensureConsent: vi.fn(),
    consentSheet: null,
  }),
}));
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/lib/minutes/meetings-on", () => ({ confirmAlert: confirm }));
const betaOff = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("@repo/validation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/validation")>()),
  isBetaOffModule: (key: string) => betaOff.keys.includes(key),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

import MinutesDetailsScreen from "@/app/(app)/minutes-details";

const WRITTEN = { summary: "Budget passed 12-3." };
function meeting(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    status: "draft",
    can_edit: true,
    event_name: "Chapter meeting",
    event_start_time: "2026-11-09T23:00:00Z",
    meeting_type: "chapter",
    other_label: null,
    posted_at: null,
    updated_at: "v1",
    sections: [],
    attendees: null,
    content: WRITTEN,
    ...over,
  };
}

/** What the recorder hook hands the screen: by default, Record on offer. */
function recorderRow(over: Record<string, unknown> = {}) {
  return {
    shown: true,
    view: { live: null },
    primary: { does: "record", label: "Record" },
    actions: [],
    run: vi.fn(),
    busy: false,
    sheets: null,
    ...over,
  };
}
const LIVE_ROW = { view: { live: "recording" }, primary: null };

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MinutesDetailsScreen />
      </FrappThemeProvider>,
    );
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

beforeEach(() => {
  vi.clearAllMocks();
  state.meeting = meeting();
  state.isPending = false;
  state.error = null;
  state.surfaces = { available: true, meetingNotes: true, ready: true };
  state.draft = { status: "none" };
  state.suggestions = [];
  state.notesSheet = 0;
  state.recording = null;
  state.recordingPending = false;
  state.row = recorderRow();
  state.rowArgs = null;
  state.stage = null;
  state.controls = 0;
  state.recorder = { phase: "idle", refusal: null };
  state.notesProps = null;
  state.summaryProps = null;
  state.event = undefined;
  state.draftPending = false;
  state.refetch.mockImplementation(async () => ({ data: state.meeting }));
  state.post.mockResolvedValue({});
  confirm.mockResolvedValue(true);
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({ id: "m1" });
});


const EMPTY = {};

describe("Recording on the minutes screen", () => {
  const available = {
    status: "none",
    available: true,
    blocked: null,
    max_seconds: 7200,
  };

  it("offers the recorder to a draft's editor where the server can transcribe", () => {
    state.recording = available;
    state.meeting = meeting({ content: EMPTY });
    render();
    expect(state.recordingEnabled).toBe(true);
    expect(state.rowArgs).toMatchObject({
      meetingId: "m1",
      eventName: "Chapter meeting",
      server: available,
      autoRecord: false,
    });
    expect(state.stage).not.toBeNull();
    // With nothing written, Record is the one thing at the bottom.
    expect(state.controls).toBeGreaterThan(0);
    // And the notes are handed the same record, for its transcript.
    expect(state.notesProps).toMatchObject({ recording: available });
  });

  it("puts Post at the bottom, not Record, once the minutes have words", () => {
    state.recording = available;
    const tree = render();
    expect(button(tree, MEETING_COPY.post)).toBeDefined();
    expect(state.controls).toBe(0);
  });

  it("asks to record straight away when opened from a Record button", () => {
    state.recording = available;
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      id: "m1",
      record: "1",
    });
    render();
    expect(state.rowArgs).toMatchObject({ autoRecord: true });
  });

  it("offers none where transcription isn't set up, and hands the notes none", () => {
    state.recording = { ...available, available: false };
    render();
    expect(state.rowArgs).toMatchObject({ server: null });
    expect(state.stage).toBeNull();
    expect(state.notesProps).toMatchObject({ recording: null });
  });

  it("never asks about a recording for a member, for posted minutes, or with drafting off", () => {
    state.recording = available;
    state.meeting = meeting({ can_edit: false });
    render();
    expect(state.recordingEnabled).toBe(false);
    expect(state.stage).toBeNull();

    state.meeting = meeting({
      status: "posted",
      posted_at: "2026-11-10T02:00:00Z",
    });
    render();
    expect(state.recordingEnabled).toBe(false);

    state.meeting = meeting();
    state.surfaces = { available: true, meetingNotes: false, ready: true };
    render();
    expect(state.recordingEnabled).toBe(false);
    expect(state.stage).toBeNull();
  });

  it("offers no Record while the server's answer is out", () => {
    state.recordingPending = true;
    state.meeting = meeting({ content: EMPTY });
    render();
    expect(state.stage).toBeNull();
    expect(state.controls).toBe(0);
  });

  describe("while this phone holds this meeting's recording", () => {
    const live = {
      phase: "recording",
      subject: {
        meetingId: "m1",
        eventName: "Chapter meeting",
        maxSeconds: 7200,
      },
      seconds: 600,
      paused: null,
    };

    it("keeps the stage, and its pinned controls, when the server's answer is out or never comes", () => {
      state.recorder = live;
      state.row = recorderRow(LIVE_ROW);
      state.recordingPending = true;
      const tree = render();
      expect(state.rowArgs).toMatchObject({ meetingId: "m1", server: null });
      expect(state.stage).not.toBeNull();
      expect(state.controls).toBeGreaterThan(0);
      // Nothing can be posted mid-recording.
      expect(button(tree, MEETING_COPY.post)).toBeUndefined();
    });

    it("keeps the stage when transcription was turned off meanwhile", () => {
      state.recorder = live;
      state.row = recorderRow(LIVE_ROW);
      state.recording = { ...available, available: false };
      render();
      expect(state.rowArgs).toMatchObject({ server: null });
      expect(state.stage).not.toBeNull();
    });

    it("keeps the stage on minutes posted from another device", () => {
      state.recorder = live;
      state.row = recorderRow(LIVE_ROW);
      state.meeting = meeting({
        status: "posted",
        posted_at: "2026-11-10T02:00:00Z",
      });
      render();
      expect(state.stage).not.toBeNull();
      expect(state.controls).toBeGreaterThan(0);
    });

    it("shows nothing for a recording of another meeting once the minutes are posted", () => {
      state.recorder = {
        ...live,
        subject: { ...live.subject, meetingId: "m2" },
      };
      state.meeting = meeting({
        status: "posted",
        posted_at: "2026-11-10T02:00:00Z",
      });
      render();
      expect(state.stage).toBeNull();
    });
  });

  it("drafts on its own once the transcript is in and nothing is written", () => {
    state.recording = {
      ...available,
      status: "ready",
      transcript: "Speaker 1: Call to order.",
      duration_seconds: 1800,
    };
    state.meeting = meeting({ content: EMPTY });
    render();
    expect(state.notesProps).toMatchObject({ autoDraft: true });

    state.meeting = meeting();
    render();
    expect(state.notesProps).toMatchObject({ autoDraft: false });
  });

  it("shows the transcript on the screen on a tap, not in a sheet", () => {
    state.recording = {
      ...available,
      status: "ready",
      transcript: "Speaker 1: Call to order.",
      duration_seconds: 1800,
    };
    const tree = render();
    const row = MEETING_RECORDER_COPY.transcriptRow(1800);
    expect(drawnText(tree.root)).not.toContain("Call to order.");
    act(() => button(tree, row).props.onPress());
    expect(drawnText(tree.root)).toContain("Speaker 1  Call to order.");
  });
});

describe("Minutes on the phone", () => {
  it("is read-only for a member: no Draft, no Post", () => {
    state.meeting = meeting({
      status: "posted",
      can_edit: false,
      posted_at: "2026-11-10T02:00:00Z",
    });
    const tree = render();
    expect(button(tree, MEETING_COPY.post)).toBeUndefined();
    expect(button(tree, MEETING_NOTES_COPY.draft)).toBeUndefined();
    expect(state.draftEnabled).toBe(false);
    expect(state.notesSheet).toBe(0);
  });

  it("puts Draft minutes at the bottom once there is something to draft from (typed notes, a note-taker's, a transcript)", async () => {
    state.meeting = meeting({ content: EMPTY });
    const tree = render();
    expect(button(tree, MEETING_NOTES_COPY.draft)).toBeUndefined();
    act(() => (state.notesProps?.onDraftable as (draftable: boolean) => void)(true));
    await act(async () =>
      button(tree, MEETING_NOTES_COPY.draft).props.onPress(),
    );
    expect(state.panelDraft).toHaveBeenCalledTimes(1);
  });

  it("without drafting, the note is the minutes' Summary, posted from here once it has words (#5288)", async () => {
    state.surfaces = { available: false, meetingNotes: false, ready: true };
    state.meeting = meeting({ content: EMPTY });
    const tree = render();
    expect(state.draftEnabled).toBe(false);
    expect(state.notesSheet).toBe(0);
    expect(state.summaryProps).not.toBeNull();
    expect(button(tree, MEETING_COPY.post)).toBeUndefined();

    act(() =>
      (state.summaryProps?.onWritten as (written: boolean) => void)(true),
    );
    state.summaryFlush.mockResolvedValue("2026-11-17T20:00:00Z");
    await act(async () => button(tree, MEETING_COPY.post).props.onPress());
    // The typed Summary is saved first, then the version is read fresh, so
    // a save on the web since isn't refused as stale for nothing.
    expect(state.summaryFlush).toHaveBeenCalledTimes(1);
    expect(state.summaryFlush.mock.invocationCallOrder[0]).toBeLessThan(
      state.refetch.mock.invocationCallOrder[0],
    );
    expect(state.post).toHaveBeenCalledWith({
      id: "m1",
      expectedUpdatedAt: "v1",
    });
  });

  it("shows no Summary while the AI reads are out or failed, so notes never land in it", () => {
    state.surfaces = { available: true, meetingNotes: false, ready: false };
    state.meeting = meeting({ content: EMPTY });
    render();
    expect(state.summaryProps).toBeNull();
    state.surfaces = {
      available: undefined,
      meetingNotes: false,
      ready: true,
    };
    render();
    expect(state.summaryProps).toBeNull();
  });

  it("doesn't post when the Summary couldn't be saved", async () => {
    state.surfaces = { available: false, meetingNotes: false, ready: true };
    const tree = render();
    state.summaryFlush.mockResolvedValue(null);
    await act(async () => button(tree, MEETING_COPY.post).props.onPress());
    expect(state.post).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(MEETING_COPY.postFailed);
  });

  it("still posts from here what was written on the web, without drafting", () => {
    state.surfaces = { available: false, meetingNotes: false, ready: true };
    const tree = render();
    expect(button(tree, MEETING_COPY.post)).toBeDefined();
  });

  it("shows the note's chips: when, type, check-ins and who reads it", () => {
    state.meeting = meeting({
      attendees: { present: ["u1", "u2"], late: ["u3"], excused: ["u4"] },
    });
    state.event = { others_invited: true, excluded_role_ids: [] };
    const text = screenText(render());
    expect(text).toContain(MEETING_COPY.checkedIn(3));
    expect(text).toContain(MEETING_COPY.audienceEveryone);
  });

  it("keeps Post at the bottom when the microphone was refused", () => {
    state.recording = {
      status: "none",
      available: true,
      blocked: null,
      max_seconds: 7200,
    };
    state.row = recorderRow({
      primary: { does: "open_settings", label: "Open Settings" },
    });
    const tree = render();
    expect(button(tree, MEETING_COPY.post)).toBeDefined();
  });

  it("posts the version the server holds now, without asking first", async () => {
    const tree = render();
    state.refetch.mockImplementation(async () => ({
      data: meeting({ updated_at: "v2" }),
    }));
    await act(async () => button(tree, MEETING_COPY.post).props.onPress());
    expect(confirm).not.toHaveBeenCalled();
    expect(state.post).toHaveBeenCalledWith({
      id: "m1",
      expectedUpdatedAt: "v2",
    });
  });

  it("says a post failed above the button", async () => {
    state.post.mockRejectedValue(new Error("nope"));
    const tree = render();
    await act(async () => button(tree, MEETING_COPY.post).props.onPress());
    expect(screenText(tree)).toContain(MEETING_COPY.postFailed);
  });

  it("can't post while a draft is being written", () => {
    state.draft = { status: "drafting" };
    const tree = render();
    expect(button(tree, MEETING_COPY.post)).toBeUndefined();
  });

  it("links the tasks suggested from posted minutes, and asks only where AI is on", () => {
    state.meeting = meeting({
      status: "posted",
      can_edit: false,
      posted_at: "2026-11-10T02:00:00Z",
    });
    state.suggestions = [
      { kind: "task", task: { title: "Book the hall" } },
      { kind: "poll", task: null },
    ];
    const tree = render();
    expect(screenText(tree)).toContain(MEETING_COPY.suggestedTasks);
    act(() =>
      tree.root
        .findAll(
          (node) =>
            typeof node.type === "string" &&
            node.props.accessibilityHint ===
              "Opens the tasks suggested from these minutes." &&
            typeof node.props.onPress === "function",
        )[0]
        .props.onPress(),
    );
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/suggested-tasks",
      params: { meetingId: "m1" },
    });

    state.surfaces = { available: false, meetingNotes: false, ready: true };
    render();
    expect(state.suggestionsEnabled).toBe(false);
  });

  it("sends a typed link to More while meetings is off for the beta", () => {
    betaOff.keys = ["meetings"];
    const tree = render();
    betaOff.keys = [];
    expect(
      tree.root.findAll((node) => (node.type as unknown) === "Redirect")[0]
        .props.href,
    ).toBe("/you");
  });

  it("never asks for suggestions on a draft", () => {
    render();
    expect(state.suggestionsEnabled).toBe(false);
  });

  it("says minutes are gone for a 404, with no retry, and offers one otherwise", () => {
    state.meeting = null;
    state.error = { status: 404 };
    const gone = screenText(render());
    expect(gone).toContain(MEETING_COPY.missingTitle);

    state.error = { status: 500 };
    expect(screenText(render())).toContain(MEETING_COPY.loadFailedTitle);
  });
});
