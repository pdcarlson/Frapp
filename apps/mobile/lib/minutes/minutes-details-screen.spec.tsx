/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { MEETING_COPY, MEETING_NOTES_COPY } from "@repo/validation";
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
  surfaces: { available: true as boolean | undefined, meetingNotes: true },
  draft: { status: "none" } as Record<string, unknown> | null,
  draftEnabled: undefined as boolean | undefined,
  draftPending: false,
  suggestions: [] as unknown[],
  suggestionsEnabled: undefined as boolean | undefined,
  post: vi.fn(),
  notesSheet: 0,
  recording: null as Record<string, unknown> | null,
  recordingEnabled: undefined as boolean | undefined,
  recordingRow: null as Record<string, unknown> | null,
  recordingPending: false,
  recordingPlaceholder: 0,
  recorder: { phase: "idle", refusal: null } as Record<string, unknown>,
  notesProps: null as Record<string, unknown> | null,
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
  useMemberDisplayNames: () => ({ nameFor: () => null }),
}));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => state.surfaces,
}));
vi.mock("@/components/screen-shell", () => ({
  ScreenShell: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => React.createElement("ScreenShell", { title }, children),
}));
vi.mock("@/components/pull-to-refresh", () => ({
  useRefetchAll: () => undefined,
}));
vi.mock("@/components/minutes/minutes-body", () => ({
  MinutesBody: () => React.createElement("MinutesBody"),
}));
vi.mock("@/components/minutes/notes-draft-sheet", async () => {
  const { forwardRef } = await import("react");
  return {
    NotesDraftSheet: forwardRef(function NotesDraftSheet(
      props: Record<string, unknown>,
    ) {
      state.notesSheet += 1;
      state.notesProps = props;
      return null;
    }),
  };
});
vi.mock("@/components/minutes/recording-row", () => ({
  RecordingRow: (props: Record<string, unknown>) => {
    state.recordingRow = props;
    return React.createElement("RecordingRow");
  },
  RecordingRowPlaceholder: () => {
    state.recordingPlaceholder += 1;
    return React.createElement("RecordingRowPlaceholder");
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

const WRITTEN = { sections: { discussion: "Budget passed 12-3." } };
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
  state.surfaces = { available: true, meetingNotes: true };
  state.draft = { status: "none" };
  state.suggestions = [];
  state.notesSheet = 0;
  state.recording = null;
  state.recordingRow = null;
  state.recordingPending = false;
  state.recordingPlaceholder = 0;
  state.recorder = { phase: "idle", refusal: null };
  state.notesProps = null;
  state.draftPending = false;
  state.refetch.mockImplementation(async () => ({ data: state.meeting }));
  state.post.mockResolvedValue({});
  confirm.mockResolvedValue(true);
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({ id: "m1" });
});

describe("Recording on the minutes screen", () => {
  const available = {
    status: "none",
    available: true,
    blocked: null,
    max_seconds: 7200,
  };

  it("offers the recorder to a draft's editor where the server can transcribe", () => {
    state.recording = available;
    render();
    expect(state.recordingEnabled).toBe(true);
    expect(state.recordingRow).toMatchObject({
      meetingId: "m1",
      eventName: "Chapter meeting",
      server: available,
    });
    // And the notes sheet is handed the same record, for its transcript.
    expect(state.notesProps).toMatchObject({ recording: available });
  });

  it("offers none where transcription isn't set up, and hands the notes none", () => {
    state.recording = { ...available, available: false };
    render();
    expect(state.recordingRow).toBeNull();
    expect(state.notesProps).toMatchObject({ recording: null });
  });

  it("never asks about a recording for a member, for posted minutes, or with drafting off", () => {
    state.recording = available;
    state.meeting = meeting({ can_edit: false });
    render();
    expect(state.recordingEnabled).toBe(false);
    expect(state.recordingRow).toBeNull();

    state.meeting = meeting({ status: "posted", posted_at: "2026-11-10T02:00:00Z" });
    render();
    expect(state.recordingEnabled).toBe(false);

    state.meeting = meeting();
    state.surfaces = { available: true, meetingNotes: false };
    render();
    expect(state.recordingEnabled).toBe(false);
    expect(state.recordingRow).toBeNull();
  });

  it("holds the row's place while the server's answer is out", () => {
    state.recordingPending = true;
    render();
    expect(state.recordingRow).toBeNull();
    expect(state.recordingPlaceholder).toBeGreaterThan(0);
  });

  describe("while this phone holds this meeting's recording", () => {
    const live = {
      phase: "recording",
      subject: { meetingId: "m1", eventName: "Chapter meeting", maxSeconds: 7200 },
      seconds: 600,
      paused: null,
    };

    it("keeps the row, and its Stop, when the server's answer is out or never comes", () => {
      state.recorder = live;
      state.recordingPending = true;
      render();
      expect(state.recordingRow).toMatchObject({ meetingId: "m1", server: null });
      expect(state.recordingPlaceholder).toBe(0);
    });

    it("keeps the row when transcription was turned off meanwhile", () => {
      state.recorder = live;
      state.recording = { ...available, available: false };
      render();
      expect(state.recordingRow).toMatchObject({ server: null });
    });

    it("keeps the row on minutes posted from another device", () => {
      state.recorder = live;
      state.meeting = meeting({
        status: "posted",
        posted_at: "2026-11-10T02:00:00Z",
      });
      render();
      expect(state.recordingRow).toMatchObject({ meetingId: "m1", server: null });
    });

    it("shows no row for a recording of another meeting once the minutes are posted", () => {
      state.recorder = { ...live, subject: { ...live.subject, meetingId: "m2" } };
      state.meeting = meeting({
        status: "posted",
        posted_at: "2026-11-10T02:00:00Z",
      });
      render();
      expect(state.recordingRow).toBeNull();
    });
  });
});

describe("Minutes on the phone", () => {
  it("is read-only for a member: no Draft, no Post, no web line", () => {
    state.meeting = meeting({
      status: "posted",
      can_edit: false,
      posted_at: "2026-11-10T02:00:00Z",
    });
    const tree = render();
    expect(button(tree, MEETING_COPY.post)).toBeUndefined();
    expect(button(tree, MEETING_NOTES_COPY.draft)).toBeUndefined();
    expect(screenText(tree)).not.toContain(MEETING_COPY.editOnWeb);
    expect(state.draftEnabled).toBe(false);
    expect(state.notesSheet).toBe(0);
  });

  it("offers Draft minutes to a draft's editor only where the server offers drafting", () => {
    const tree = render();
    expect(button(tree, MEETING_NOTES_COPY.draft)).toBeDefined();
    expect(screenText(tree)).toContain(MEETING_COPY.editOnWeb);

    state.surfaces = { available: false, meetingNotes: false };
    const without = render();
    expect(button(without, MEETING_NOTES_COPY.draft)).toBeUndefined();
    expect(state.draftEnabled).toBe(false);
    // Still postable: what was written on the web can be posted from here.
    expect(button(without, MEETING_COPY.post)).toBeDefined();
  });

  it("holds Draft minutes' place while its read is out, so Post doesn't move", () => {
    state.draftPending = true;
    state.meeting = meeting({ content: {} });
    const tree = render();
    expect(button(tree, MEETING_NOTES_COPY.draft).props.disabled).toBe(true);
    // Not "write them on the web": the phone is about to offer drafting.
    expect(screenText(tree)).not.toContain(MEETING_COPY.writeOnWeb);
  });

  it("sends an editor with nothing written, and no drafting, to the web", () => {
    state.surfaces = { available: false, meetingNotes: false };
    state.meeting = meeting({ content: {} });
    const tree = render();
    expect(screenText(tree)).toContain(MEETING_COPY.writeOnWeb);
    expect(button(tree, MEETING_COPY.post).props.disabled).toBe(true);
  });

  it("asks before posting, then posts the version the server holds now", async () => {
    const tree = render();
    state.refetch.mockImplementation(async () => ({
      data: meeting({ updated_at: "v2" }),
    }));
    await act(async () => button(tree, MEETING_COPY.post).props.onPress());
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: MEETING_COPY.postConfirmTitle }),
    );
    expect(state.post).toHaveBeenCalledWith({
      id: "m1",
      expectedUpdatedAt: "v2",
    });
  });

  it("posts nothing when the officer says Cancel", async () => {
    confirm.mockResolvedValue(false);
    const tree = render();
    await act(async () => button(tree, MEETING_COPY.post).props.onPress());
    expect(state.post).not.toHaveBeenCalled();
  });

  it("says a post failed in the web line's place", async () => {
    state.post.mockRejectedValue(new Error("nope"));
    const tree = render();
    await act(async () => button(tree, MEETING_COPY.post).props.onPress());
    expect(screenText(tree)).not.toContain(MEETING_COPY.editOnWeb);
  });

  it("can't post while a draft is being written", () => {
    state.draft = { status: "drafting" };
    const tree = render();
    expect(button(tree, MEETING_COPY.post).props.disabled).toBe(true);
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

    state.surfaces = { available: false, meetingNotes: false };
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
