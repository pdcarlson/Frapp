/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import {
  EMPTY_MEETING_CONTENT,
  MEETING_COPY,
  MEETING_NOTES_COPY,
  MEETING_RECORDER_COPY,
  MINUTES_EDITOR_COPY,
  MINUTES_FLOW_COPY,
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
  panelStop: vi.fn(),
  othersWrote: false,
  row: null as Record<string, unknown> | null,
  rowArgs: null as Record<string, unknown> | null,
  stage: null as Record<string, unknown> | null,
  controls: 0,
  summaryProps: null as Record<string, unknown> | null,
  summaryFlush: vi.fn(),
  event: undefined as Record<string, unknown> | undefined,
  permissions: [] as string[],
  menu: null as {
    title: string;
    actions: { key: string; label: string }[];
  } | null,
  remove: vi.fn(),
  update: vi.fn(),
  updatePending: false,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCachedMeetingRow: () => null,
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
  useCurrentUser: () => ({ data: { id: "u1" } }),
  usePermissionList: () => state.permissions,
  useDeleteMeeting: () => ({ mutateAsync: state.remove, isPending: false }),
  useUpdateMeeting: () => ({
    mutateAsync: state.update,
    isPending: state.updatePending,
  }),
  useMeetingActionItemTasks: () => ({ data: [] }),
}));
vi.mock("@/components/item-actions-menu", () => ({
  useItemMenu: () => ({
    handleFor: (menu: NonNullable<typeof state.menu>) => ({
      ...menu,
      open: () => {
        state.menu = menu;
      },
    }),
    element: null,
  }),
}));
vi.mock("@/components/minutes/minutes-details-sheet", async () => {
  const { forwardRef } = await import("react");
  return { MinutesDetailsSheet: forwardRef(() => null) };
});
vi.mock("@/components/minutes/mark-attendance-sheet", async () => {
  const { forwardRef } = await import("react");
  return { MarkAttendanceSheet: forwardRef(() => null) };
});
vi.mock("@/lib/tasks/use-who-directory", () => ({
  useWhoDirectory: () => ({
    directory: {},
    people: "ready",
    sets: "ready",
    followers: [],
  }),
}));
vi.mock("@/components/tasks/who-picker-sheet", async () => {
  const { forwardRef } = await import("react");
  return { WhoPickerSheet: forwardRef(() => null) };
});
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => state.surfaces,
}));
vi.mock("@/components/screen-shell", () => ({
  ScreenShell: ({
    title,
    subtitle,
    backAction,
    children,
    footer,
  }: {
    title: string;
    subtitle?: string;
    backAction?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    React.createElement(
      "ScreenShell",
      { title },
      subtitle ? React.createElement("Text", null, subtitle) : null,
      backAction,
      children,
      footer,
    ),
  StickyHeader: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/pull-to-refresh", () => ({
  useRefetchAll: () => undefined,
}));
vi.mock("@/components/minutes/minutes-body", () => ({
  MinutesBody: () => React.createElement("MinutesBody"),
  MinutesJumpBar: () => null,
}));
vi.mock("@/components/minutes/notes-panel", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    NotesPanel: forwardRef(function NotesPanel(
      props: Record<string, unknown>,
      ref: React.Ref<{ draft: () => Promise<void> }>,
    ) {
      useImperativeHandle(ref, () => ({
        draft: state.panelDraft,
        stop: state.panelStop,
      }));
      state.notesSheet += 1;
      state.notesProps = props;
      return null;
    }),
    useOtherSources: () => ({
      othersWrote: state.othersWrote,
      takersWrote: state.othersWrote,
      transcriptReady: false,
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
    event_id: "e1",
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
  state.othersWrote = false;
  state.summaryProps = null;
  state.event = undefined;
  state.draftPending = false;
  state.refetch.mockImplementation(async () => ({ data: state.meeting }));
  state.post.mockResolvedValue({});
  state.updatePending = false;
  state.update.mockImplementation(
    async ({ body }: { body: { content: Record<string, unknown> } }) =>
      meeting({
        ...(state.meeting ?? {}),
        content: body.content,
        updated_at: "v2",
      }),
  );
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

  it("opens the transcript on its own screen, never under the minutes", () => {
    state.recording = {
      ...available,
      status: "ready",
      transcript: "Speaker 1: Call to order.",
      duration_seconds: 1800,
    };
    const tree = render();
    const row = MEETING_RECORDER_COPY.transcriptRow(1800);
    act(() => button(tree, row).props.onPress());
    // An hour of lines would push the minutes away (Paul, 2026-11-18).
    expect(drawnText(tree.root)).not.toContain("Call to order.");
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/minutes-transcript",
      params: { id: "m1" },
    });
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
    act(() =>
      (state.notesProps?.onDraftable as (draftable: boolean) => void)(true),
    );
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

  it("says what kind of meeting and when on one line, not a row of chips (#5562)", () => {
    const text = screenText(render());
    expect(text).toMatch(/Chapter meeting, .* · Draft/);
  });

  it("opens web's ⋯ menu, in web's order, from beside the back row (#5562)", () => {
    state.permissions = ["events:update"];
    try {
      state.meeting = meeting({
        status: "posted",
        posted_at: "2026-11-10T01:00:00.000Z",
        can_edit: true,
        can_delete: true,
        transcript: "Speaker 1: Hello.",
        event_end_time: "2026-11-10T00:00:00.000Z",
      });
      const tree = render();
      act(() => {
        tree.root
          .findAll(
            (node) =>
              node.props.accessibilityLabel === "More" &&
              typeof node.props.onPress === "function",
          )[0]!
          .props.onPress();
      });
      expect(state.menu?.actions.map((action) => action.label)).toEqual([
        "Edit details",
        "Edit minutes",
        "Mark who was there",
        "Copy link",
        "Open event",
        "Transcript",
        "Delete minutes",
      ]);
    } finally {
      state.permissions = [];
      state.menu = null;
    }
  });

  it("leaves out what a member can't do from the ⋯ menu", () => {
    state.meeting = meeting({
      status: "posted",
      posted_at: "2026-11-10T01:00:00.000Z",
      can_edit: false,
      can_delete: false,
    });
    const tree = render();
    act(() => {
      tree.root
        .findAll(
          (node) =>
            node.props.accessibilityLabel === "More" &&
            typeof node.props.onPress === "function",
        )[0]!
        .props.onPress();
    });
    expect(state.menu?.actions.map((action) => action.label)).toEqual([
      "Copy link",
      "Open event",
    ]);
    state.menu = null;
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

  it("pins Drafting and Stop at the bottom while a draft is written, never Record (#5562)", async () => {
    state.draft = { status: "drafting" };
    state.recording = {
      status: "none",
      available: true,
      blocked: null,
      max_seconds: 7200,
    };
    state.row = recorderRow();
    state.panelStop.mockResolvedValue(undefined);
    const tree = render();
    // Web's steps, and Drafting pinned with Stop drafting (#5562).
    expect(screenText(tree)).toContain("Saved your notes");
    expect(screenText(tree)).toContain("Writing the minutes");
    expect(screenText(tree)).toContain(MINUTES_FLOW_COPY.drafting.leave);
    expect(screenText(tree)).toContain(MINUTES_FLOW_COPY.drafting.badge);
    expect(button(tree, "Record")).toBeUndefined();
    expect(state.notesProps?.stopInFooter).toBe(true);
    await act(async () =>
      button(tree, MINUTES_FLOW_COPY.drafting.stop).props.onPress(),
    );
    expect(state.panelStop).toHaveBeenCalledTimes(1);
  });

  it("says the draft reads everyone's notes when others wrote too, as the web does (#5562)", () => {
    state.draft = { status: "drafting" };
    state.othersWrote = true;
    const tree = render();
    expect(screenText(tree)).toContain(
      MINUTES_FLOW_COPY.drafting.steps.everyone,
    );
  });

  it("asks how the meeting went before anything is written, and banners a draft once it is in", () => {
    state.draft = { status: "none" };
    state.meeting = meeting({ content: EMPTY_MEETING_CONTENT });
    const start = render();
    expect(screenText(start)).toContain(MINUTES_FLOW_COPY.start.heading);

    state.draft = { status: "applied", notes: "budget passed" };
    state.meeting = meeting();
    const review = render();
    expect(screenText(review)).toContain(
      MINUTES_FLOW_COPY.review.banner("notes"),
    );
    expect(screenText(review)).not.toContain(MINUTES_FLOW_COPY.start.heading);
    expect(state.notesProps?.bannerAbove).toBe(true);
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

describe("Edit minutes on the phone (#4412)", () => {
  /** Opens the ⋯ menu and presses one of its items. */
  async function fromMenu(tree: ReactTestRenderer, label: string) {
    act(() => {
      tree.root
        .findAll(
          (node) =>
            node.props.accessibilityLabel === "More" &&
            typeof node.props.onPress === "function",
        )[0]!
        .props.onPress();
    });
    const action = state.menu?.actions.find((item) => item.label === label);
    state.menu = null;
    expect(action).toBeDefined();
    await act(async () => (action as unknown as { run: () => void }).run());
  }
  const field = (tree: ReactTestRenderer, label: string) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "TextInput" &&
        node.props.accessibilityLabel === label,
    )[0];
  const hasBody = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => (node.type as unknown) === "MinutesBody")
      .length > 0;

  it("offers Edit minutes after Edit details, and not while a draft is written", () => {
    state.draft = { status: "drafting" };
    const tree = render();
    act(() => {
      tree.root
        .findAll(
          (node) =>
            node.props.accessibilityLabel === "More" &&
            typeof node.props.onPress === "function",
        )[0]!
        .props.onPress();
    });
    expect(state.menu?.actions.map((action) => action.label)).not.toContain(
      "Edit minutes",
    );
    state.menu = null;
  });

  it("turns the screen into the section editor, and a draft saves as typing rests", async () => {
    vi.useFakeTimers();
    try {
      state.draft = { status: "applied", notes: "budget passed" };
      const tree = render();
      await fromMenu(tree, "Edit minutes");
      expect(hasBody(tree)).toBe(false);
      // Only the section with words, and Add a section for the rest.
      expect(field(tree, "Summary")?.props.value).toBe("Budget passed 12-3.");
      expect(button(tree, MINUTES_FLOW_COPY.review.addSection)).toBeDefined();
      expect(screenText(tree)).not.toContain(
        MINUTES_FLOW_COPY.review.banner("notes"),
      );

      act(() =>
        field(tree, "Summary")!.props.onChangeText(
          "Budget passed 12-3. Dues next.",
        ),
      );
      expect(state.update).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(1200));
      expect(state.update).toHaveBeenCalledWith({
        id: "m1",
        body: {
          expected_updated_at: "v1",
          content: expect.objectContaining({
            summary: "Budget passed 12-3. Dues next.",
          }),
        },
      });
      expect(screenText(tree)).toContain(MINUTES_EDITOR_COPY.saved);

      // Done goes back to reading.
      await act(async () =>
        button(tree, MINUTES_EDITOR_COPY.done).props.onPress(),
      );
      expect(hasBody(tree)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds a decision with a vote count and an action item, dropping empty rows on save", async () => {
    state.meeting = meeting({
      status: "posted",
      posted_at: "2026-11-10T01:00:00.000Z",
      sections: ["summary", "decisions", "action_items"],
    });
    const tree = render();
    await fromMenu(tree, "Edit minutes");
    // Written by hand, the template's sections are laid out to fill in.
    act(() => button(tree, MINUTES_EDITOR_COPY.decision.add).props.onPress());
    act(() =>
      field(tree, MINUTES_EDITOR_COPY.decision.label(1))!.props.onChangeText(
        "Dues rise to $250",
      ),
    );
    act(() =>
      button(tree, MINUTES_EDITOR_COPY.decision.addVote).props.onPress(),
    );
    act(() =>
      field(tree, MINUTES_EDITOR_COPY.decision.for)!.props.onChangeText("12"),
    );
    act(() => button(tree, MINUTES_EDITOR_COPY.actionItem.add).props.onPress());
    // A posted edit waits for Save: nothing has gone out.
    expect(state.update).not.toHaveBeenCalled();
    await act(async () =>
      button(tree, MINUTES_EDITOR_COPY.save).props.onPress(),
    );
    expect(state.update).toHaveBeenCalledTimes(1);
    const sent = state.update.mock.calls[0]![0].body.content;
    expect(sent.decisions).toEqual([
      {
        text: "Dues rise to $250",
        headline: null,
        vote: { for: 12, against: 0, abstain: 0 },
      },
    ]);
    expect(sent.action_items).toEqual([]);
    expect(hasBody(tree)).toBe(true);
    expect(screenText(tree)).toContain(MINUTES_EDITOR_COPY.savedToast);
  });

  it("Cancel on posted minutes puts them back and saves nothing", async () => {
    state.meeting = meeting({
      status: "posted",
      posted_at: "2026-11-10T01:00:00.000Z",
    });
    const tree = render();
    await fromMenu(tree, "Edit minutes");
    act(() => field(tree, "Summary")!.props.onChangeText("Something else"));
    act(() => button(tree, MINUTES_EDITOR_COPY.cancel).props.onPress());
    expect(state.update).not.toHaveBeenCalled();
    expect(hasBody(tree)).toBe(true);
  });

  it("keeps every word typed when the save is stale, and offers their version", async () => {
    state.meeting = meeting({
      status: "posted",
      posted_at: "2026-11-10T01:00:00.000Z",
    });
    state.update.mockRejectedValue({ code: "meeting.stale" });
    const tree = render();
    await fromMenu(tree, "Edit minutes");
    act(() => field(tree, "Summary")!.props.onChangeText("Mine, typed here"));
    await act(async () =>
      button(tree, MINUTES_EDITOR_COPY.save).props.onPress(),
    );
    expect(field(tree, "Summary")?.props.value).toBe("Mine, typed here");
    expect(screenText(tree)).toContain(MEETING_COPY.stale);
    expect(button(tree, MEETING_COPY.loadTheirs)).toBeDefined();
  });

  it("posts from the editor, saving what is typed first", async () => {
    state.draft = { status: "applied", notes: "budget passed" };
    const tree = render();
    await fromMenu(tree, "Edit minutes");
    act(() =>
      field(tree, "Summary")!.props.onChangeText(
        "Budget passed 12-3, 2 abstained.",
      ),
    );
    state.refetch.mockImplementation(async () => ({
      data: meeting({ updated_at: "v2" }),
    }));
    await act(async () => button(tree, MEETING_COPY.post).props.onPress());
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.post).toHaveBeenCalledWith({
      id: "m1",
      expectedUpdatedAt: "v2",
    });
    expect(hasBody(tree)).toBe(true);
  });

  it("writes the minutes by hand from the start box, with the template laid out", async () => {
    state.draft = { status: "none" };
    state.meeting = meeting({
      content: EMPTY_MEETING_CONTENT,
      sections: ["tldr", "summary", "decisions", "action_items"],
    });
    const tree = render();
    await act(async () =>
      button(tree, MINUTES_FLOW_COPY.start.byHand).props.onPress(),
    );
    expect(field(tree, "TL;DR")).toBeDefined();
    expect(field(tree, "Summary")).toBeDefined();
    expect(button(tree, MINUTES_EDITOR_COPY.decision.add)).toBeDefined();
    expect(button(tree, MINUTES_EDITOR_COPY.actionItem.add)).toBeDefined();
  });

  it("opens the editor from the Summary note's line, saving the note first", async () => {
    state.surfaces = { available: true, meetingNotes: false, ready: true };
    state.summaryFlush.mockResolvedValue("v1");
    const tree = render();
    await act(async () => (state.summaryProps!.onEditAll as () => void)());
    expect(state.summaryFlush).toHaveBeenCalled();
    expect(field(tree, "Summary")).toBeDefined();
    // The note steps aside while the editor has the Summary.
    expect(
      tree.root.findAll((node) => (node.type as unknown) === "SummaryNote"),
    ).toHaveLength(0);
  });
});
