/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import {
  MEETING_ENTRY_COPY,
  MEETING_NOTE_TAKERS_COPY,
  MINUTES_REQUEST_COPY,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * An event's way into its minutes on the phone (#4312): Write minutes for
 * every officer who records them, drafting or not (#5288), and Record
 * minutes only where drafting and the phone's recorder both are.
 */
const state = vi.hoisted(() => ({
  on: true,
  meetings: [] as { id: string; status: string }[],
  isSuccess: true,
  permissions: ["meetings:record"] as string[],
  canDraft: true,
  start: vi.fn(),
  refetch: vi.fn(),
  enabled: undefined as boolean | undefined,
  taking: [] as { meeting_id: string; author_name: string; joined: boolean }[],
  recorder: null as object | null,
  recorderState: { phase: "idle", refusal: null } as Record<string, unknown>,
  takingPending: false,
  request: null as null | {
    meeting_id: string;
    event_id: string;
    requested: boolean;
  },
  ask: vi.fn(),
}));
vi.mock("@/lib/minutes/recorder/session", () => ({
  useMeetingRecorder: () => ({
    state: state.recorderState,
    recorder: state.recorder,
  }),
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMeetings: (options: { enabled: boolean }) => {
    state.enabled = options.enabled;
    return {
      data: state.meetings,
      isSuccess: state.isSuccess,
      refetch: state.refetch,
    };
  },
  usePermissionList: () => state.permissions,
  useStartMeeting: () => ({ mutateAsync: state.start, isPending: false }),
  useMeetingNoteTaking: () => ({
    data: state.taking ?? [],
    isPending: state.takingPending,
  }),
  useMinutesRequest: () => ({ data: state.request, isLoading: false }),
  useRequestMinutes: () => ({ mutateAsync: state.ask, isPending: false }),
}));
vi.mock("@/components/minutes/note-taker-sheet", () => ({
  NoteTakerSheet: () => null,
}));
vi.mock("@/lib/minutes/meetings-on", () => ({
  useMeetingsOn: () => state.on,
}));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({ meetingNotes: state.canDraft }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

import { EventMinutesRow } from "./event-minutes-row";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <EventMinutesRow eventId="e1" eventName="Chapter meeting" />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const rows = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" && typeof node.props.onPress === "function",
  );

beforeEach(() => {
  vi.clearAllMocks();
  state.on = true;
  state.meetings = [];
  state.isSuccess = true;
  state.permissions = ["meetings:record"];
  state.canDraft = true;
  state.taking = [];
  state.recorder = null;
  state.recorderState = { phase: "idle", refusal: null };
  state.takingPending = false;
  state.request = null;
});

describe("EventMinutesRow", () => {
  it("draws nothing, and reads nothing, with the meetings module off", () => {
    state.on = false;
    state.meetings = [{ id: "m1", status: "posted" }];
    expect(render().toJSON()).toBeNull();
    expect(state.enabled).toBe(false);
  });

  it("draws nothing until the read answers, so a failed read offers no Write", () => {
    state.isSuccess = false;
    expect(render().toJSON()).toBeNull();
  });

  it.each([
    ["posted", MEETING_ENTRY_COPY.posted],
    ["draft", MEETING_ENTRY_COPY.draft],
  ])("opens %s minutes the viewer may read", (status, value) => {
    state.permissions = [];
    state.meetings = [{ id: "m1", status }];
    const tree = render();
    expect(screenText(tree)).toContain(MEETING_ENTRY_COPY.label);
    expect(screenText(tree)).toContain(value);
    act(() => rows(tree)[0].props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/minutes-details",
      params: { id: "m1" },
    });
  });

  it("says where the minutes stand, what they hold, and their TL;DR's first line, as web does", () => {
    state.permissions = [];
    state.meetings = [
      {
        id: "m1",
        status: "posted",
        posted_at: "2026-11-18T12:00:00Z",
        decision_count: 2,
        action_item_count: 3,
        gist: "Dues are due Friday.",
      } as never,
    ];
    const text = screenText(render());
    expect(text).toMatch(
      /Posted \w+, November 18 · 2 decisions · 3 action items/,
    );
    expect(text).toContain("Dues are due Friday.");
  });

  it("offers Take notes on someone else's draft, to a member they added (#4935)", () => {
    state.permissions = [];
    state.taking = [
      { meeting_id: "m9", author_name: "Eli Sorensen", joined: false },
    ];
    const tree = render();
    expect(screenText(tree)).toContain(MEETING_NOTE_TAKERS_COPY.takeNotes);
    expect(screenText(tree)).toContain(
      MEETING_NOTE_TAKERS_COPY.listItem("Eli Sorensen"),
    );
  });

  it("offers nothing to a member when there are no minutes", () => {
    state.permissions = [];
    expect(render().toJSON()).toBeNull();
  });

  it("offers Write minutes without drafting too: the note is the Summary (#5288)", () => {
    state.canDraft = false;
    expect(screenText(render())).toContain(MEETING_ENTRY_COPY.write);
    // A phone that can record still writes here: recording waits on drafting
    // (#5289), so Record minutes would open on nothing recording.
    state.recorder = {};
    const text = screenText(render());
    expect(text).toContain(MEETING_ENTRY_COPY.write);
    expect(text).not.toContain(MEETING_ENTRY_COPY.record);
  });

  it("starts minutes in one tap for an officer who can draft, and opens them", async () => {
    state.start.mockResolvedValue({ id: "m9" });
    const tree = render();
    expect(screenText(tree)).toContain(MEETING_ENTRY_COPY.write);
    await act(async () => rows(tree)[0].props.onPress());
    expect(state.start).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: "e1" }),
    );
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/minutes-details",
      params: { id: "m9" },
    });
  });

  it("says someone else already started them, and reads again", async () => {
    state.start.mockRejectedValue({ code: "meeting.already_started" });
    const tree = render();
    await act(async () => rows(tree)[0].props.onPress());
    expect(state.refetch).toHaveBeenCalled();
    expect(screenText(tree)).toContain(MEETING_ENTRY_COPY.alreadyStartedBody);
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
  });

  it("records where this phone can: starts them and opens them asking to record", async () => {
    state.recorder = {};
    state.start.mockResolvedValue({ id: "m9" });
    const tree = render();
    expect(screenText(tree)).toContain(MEETING_ENTRY_COPY.record);
    expect(screenText(tree)).not.toContain(MEETING_ENTRY_COPY.write);
    await act(async () => rows(tree)[0].props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/minutes-details",
      params: { id: "m9", record: "1" },
    });
  });

  it("offers Write, not a second recording, while the phone already records", () => {
    state.recorder = {};
    state.recorderState = {
      phase: "recording",
      subject: { meetingId: "m2", eventName: "Other", maxSeconds: 7200 },
      seconds: 10,
      paused: null,
    };
    expect(screenText(render())).toContain(MEETING_ENTRY_COPY.write);
  });

  describe("Request minutes (#5471)", () => {
    beforeEach(() => {
      state.permissions = [];
      state.request = { meeting_id: "m7", event_id: "e1", requested: false };
    });

    it("offers Request minutes on unposted minutes the member can't open", async () => {
      state.ask.mockResolvedValue({
        ...state.request,
        requested: true,
        pinged: true,
      });
      const tree = render();
      expect(screenText(tree)).toContain(MINUTES_REQUEST_COPY.request);
      expect(screenText(tree)).toContain(MINUTES_REQUEST_COPY.notPosted);
      await act(async () => {
        rows(tree)[0].props.onPress();
      });
      expect(state.ask).toHaveBeenCalledWith("m7");
    });

    it("reads Requested once the member has asked, with nothing to press", () => {
      state.request = { meeting_id: "m7", event_id: "e1", requested: true };
      const tree = render();
      expect(screenText(tree)).toContain(MINUTES_REQUEST_COPY.requested);
      expect(screenText(tree)).not.toContain(MINUTES_REQUEST_COPY.request);
      expect(rows(tree)).toHaveLength(0);
    });

    it("keeps Take notes for a note-taker, and waits for that read before offering Request", () => {
      state.takingPending = true;
      expect(screenText(render())).not.toContain(MINUTES_REQUEST_COPY.request);
      state.takingPending = false;
      state.taking = [{ meeting_id: "m7", author_name: "Eli", joined: false }];
      const text = screenText(render());
      expect(text).toContain(MEETING_NOTE_TAKERS_COPY.takeNotes);
      expect(text).not.toContain(MINUTES_REQUEST_COPY.request);
    });

    it("offers nothing once the minutes are posted and readable", () => {
      state.meetings = [{ id: "m7", status: "posted" }];
      const text = screenText(render());
      expect(text).not.toContain(MINUTES_REQUEST_COPY.request);
      expect(text).toContain(MEETING_ENTRY_COPY.posted);
    });
  });
});
