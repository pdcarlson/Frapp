/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";

/**
 * The +'s Record meeting and New minutes (#5287), as the secretary uses
 * them: the row is there only where the minutes screen's own Record would
 * be, it names the meeting it will use, the AI question comes before the
 * notice, and Start recording starts the minutes, opens them and starts the
 * recorder. A meeting already holding someone else's minutes is joined,
 * not split; the member's own draft with a recording is opened, not
 * overwritten; and a calendar that can't be read says so. The pick itself
 * is `lib/minutes/start-minutes.spec.ts`'s.
 */
const NOW = Date.now();
const iso = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const data = vi.hoisted(() => ({
  permissions: ["meetings:record"] as string[],
  meetingsOn: true,
  meetingNotes: true,
  available: true as boolean | null,
  blocked: null as null | "consent_required" | "chapter_off",
  events: [] as object[],
  meetings: [] as object[],
  eventsError: false,
  refetchEvents: vi.fn(),
  refetchMeetings: vi.fn(),
  /** What GET /v1/meetings/{id}/recording answers. */
  recordingStatus: "none" as string,
  start: vi.fn(),
  consent: vi.fn(),
  refetchAvailability: vi.fn(),
  state: { phase: "idle", refusal: null } as unknown,
  hasRecorder: true,
  recorderStart: vi.fn(),
  clearRefusal: vi.fn(),
  noticePresent: vi.fn(),
  minutesPresent: vi.fn(),
  noticeProps: null as null | { onStart: () => void; maxSeconds: number },
  startButton: null as null | {
    onPress: () => Promise<void>;
    disabled?: boolean;
  },
}));

vi.mock("@repo/hooks", () => ({
  usePermissionList: () => data.permissions,
  useViewerUserId: () => "me",
  useFrappClient: () => ({
    GET: async () => ({ data: { status: data.recordingStatus } }),
  }),
  useEvents: (options: { enabled: boolean }) =>
    !options.enabled
      ? {
          data: undefined,
          isSuccess: false,
          isError: false,
          refetch: data.refetchEvents,
        }
      : data.eventsError
        ? {
            data: undefined,
            isSuccess: false,
            isError: true,
            refetch: data.refetchEvents,
          }
        : {
            data: data.events,
            isSuccess: true,
            isError: false,
            refetch: data.refetchEvents,
          },
  useMeetings: (options?: { enabled: boolean }) =>
    options?.enabled === false
      ? {
          data: undefined,
          isSuccess: false,
          isError: false,
          refetch: data.refetchMeetings,
        }
      : {
          data: data.meetings,
          isSuccess: true,
          isError: false,
          refetch: data.refetchMeetings,
        },
  useMeetingRecorderAvailability: () => ({
    data:
      data.available === null
        ? null
        : {
            available: data.available,
            blocked: data.blocked,
            max_bytes: 1,
            max_seconds: 3600,
          },
    refetch: data.refetchAvailability,
  }),
  useStartMeeting: () => ({ mutateAsync: data.start, isPending: false }),
}));
vi.mock("@/lib/minutes/meetings-on", () => ({
  useMeetingsOn: () => data.meetingsOn,
}));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({ meetingNotes: data.meetingNotes }),
}));
vi.mock("@/components/ai/meet-frapp-ai", () => ({
  useAiConsentGate: () => ({ ensureConsent: data.consent, consentSheet: null }),
}));
vi.mock("@/lib/minutes/recorder/session", () => ({
  useMeetingRecorder: () => ({
    state: data.state,
    recorder: data.hasRecorder
      ? { start: data.recorderStart, clearRefusal: data.clearRefusal }
      : null,
  }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));
function keepNoticeProps(props: { onStart: () => void; maxSeconds: number }) {
  data.noticeProps = props;
}
vi.mock("@/components/minutes/recording-notice-sheet", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    RecordingNoticeSheet: forwardRef(function RecordingNoticeSheet(
      props: { onStart: () => void; maxSeconds: number },
      ref,
    ) {
      keepNoticeProps(props);
      useImperativeHandle(ref, () => ({ present: data.noticePresent }));
      return null;
    }),
  };
});
// New minutes' sheet draws its contents, so a spec can press Start minutes.
vi.mock("@gorhom/bottom-sheet", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    BottomSheetModal: forwardRef(function BottomSheetModal(
      props: { children: React.ReactNode },
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        present: data.minutesPresent,
        dismiss: vi.fn(),
      }));
      return <>{props.children}</>;
    }),
  };
});
// The picker is `meeting-pick-field`'s own; here it is a stand-in.
vi.mock("@/components/minutes/meeting-pick-field", () => ({
  MeetingPickField: () => null,
}));
vi.mock("@/lib/sheet-scrollables", () => ({
  BottomSheetScrollView: (props: { children: React.ReactNode }) => (
    <>{props.children}</>
  ),
}));
function keepStartButton(props: {
  onPress: () => Promise<void>;
  disabled?: boolean;
}) {
  data.startButton = props;
}
vi.mock("@/components/sheet-scaffold", () => ({
  SHEET_STACK_BEHAVIOR: "push",
  SheetBackToClose: () => null,
  SheetGrabber: () => null,
  SheetScrim: () => null,
  useSheetBackgroundStyle: () => ({}),
  useSheetClose: () => vi.fn(),
  SheetPrimaryButton: (props: {
    onPress: () => Promise<void>;
    disabled?: boolean;
  }) => {
    keepStartButton(props);
    return null;
  },
}));

import { FrappThemeProvider } from "@/lib/theme";
import { useMeetingQuickActions } from "./meeting-actions";

type Actions = ReturnType<typeof useMeetingQuickActions>;
let latest!: Actions;
const capture = (actions: Actions) => {
  latest = actions;
};
const confirm = vi.fn();
function Harness({ onActions = capture }: { onActions?: typeof capture }) {
  const actions = useMeetingQuickActions({ confirm });
  onActions(actions);
  return <>{actions.sheets}</>;
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Harness />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const router = () => vi.mocked(expoRouter.useRouter());

beforeEach(() => {
  vi.clearAllMocks();
  data.permissions = ["meetings:record"];
  data.meetingsOn = true;
  data.meetingNotes = true;
  data.available = true;
  data.blocked = null;
  data.events = [];
  data.meetings = [];
  data.state = { phase: "idle", refusal: null };
  data.hasRecorder = true;
  data.noticeProps = null;
  data.startButton = null;
  data.eventsError = false;
  data.recordingStatus = "none";
  data.consent.mockResolvedValue(true);
  data.start.mockResolvedValue({ id: "m-new" });
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
    run();
    return 0;
  });
});

describe("the Record meeting row", () => {
  it("names the meeting on now", () => {
    data.events = [
      {
        id: "e1",
        name: "Chapter Meeting",
        start_time: iso(-10),
        end_time: iso(90),
      },
    ];
    render();
    expect(latest.record?.detail).toBe("Chapter Meeting is on now");
  });

  it("says it starts a new meeting when nothing is on", () => {
    render();
    expect(latest.record?.detail).toBe("Starts a new meeting, today");
  });

  it("follows the clock, not the last read: a meeting that starts later is found once it's on", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(NOW);
      data.events = [
        {
          id: "e1",
          name: "Chapter Meeting",
          start_time: iso(60),
          end_time: iso(120),
        },
      ];
      const tree = render();
      expect(latest.record?.detail).toBe("Starts a new meeting, today");
      vi.setSystemTime(NOW + 65 * 60_000);
      act(() =>
        tree.update(
          <FrappThemeProvider>
            <Harness />
          </FrappThemeProvider>,
        ),
      );
      expect(latest.record?.detail).toBe("Chapter Meeting is on now");
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a meeting on now that already has someone else's minutes, and opens its event", () => {
    data.events = [
      {
        id: "e1",
        name: "Chapter Meeting",
        start_time: iso(-10),
        end_time: iso(90),
      },
    ];
    data.meetings = [
      {
        id: "m-theirs",
        event_id: "e1",
        status: "draft",
        created_by: "president",
      },
    ];
    render();
    expect(latest.record?.detail).toBe(
      "Chapter Meeting already has minutes. Open the event to take notes.",
    );
    act(() => latest.record?.onPress());
    expect(router().push).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: "e1" },
    });
    expect(data.noticePresent).not.toHaveBeenCalled();
  });

  it("says when the calendar couldn't be read, and asks again on a tap", async () => {
    data.eventsError = true;
    render();
    expect(latest.record?.detail).toMatch(/^Couldn't read the calendar/);
    await act(async () => latest.record?.onPress());
    expect(data.refetchEvents).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/^Couldn't read the calendar/),
    );
    expect(data.noticePresent).not.toHaveBeenCalled();
  });

  it.each([
    ["no meetings:record", () => (data.permissions = [])],
    ["the module off", () => (data.meetingsOn = false)],
    ["no drafting", () => (data.meetingNotes = false)],
    ["no transcription", () => (data.available = false)],
    ["AI off on the server", () => (data.available = null)],
    ["the chapter's switch off", () => (data.blocked = "chapter_off")],
    ["a build with no microphone", () => (data.hasRecorder = false)],
  ])("is not offered with %s", (_why, set) => {
    set();
    render();
    expect(latest.record).toBeNull();
  });

  it("opens the recording the phone holds instead of starting one", () => {
    data.available = false;
    data.state = {
      phase: "recording",
      subject: { meetingId: "m-held", eventName: "Exec", maxSeconds: 3600 },
      seconds: 724,
      paused: null,
    };
    render();
    expect(latest.record).toMatchObject({ held: true });
    expect(latest.record?.detail).toMatch(/^Recording 12:04/);
    act(() => latest.record?.onPress());
    expect(router().push).toHaveBeenCalledWith({
      pathname: "/minutes-details",
      params: { id: "m-held" },
    });
    expect(data.noticePresent).not.toHaveBeenCalled();
  });
});

describe("recording from the +", () => {
  it("asks the AI question first, then shows the notice", async () => {
    data.blocked = "consent_required";
    render();
    await act(async () => latest.record?.onPress());
    expect(data.consent).toHaveBeenCalled();
    expect(data.noticePresent).toHaveBeenCalledTimes(1);
  });

  it("stops at a No on the AI question", async () => {
    data.blocked = "consent_required";
    data.consent.mockResolvedValue(false);
    render();
    await act(async () => latest.record?.onPress());
    expect(data.noticePresent).not.toHaveBeenCalled();
  });

  it("starts the minutes, opens them and starts the recorder on Start", async () => {
    render();
    await act(async () => latest.record?.onPress());
    expect(data.noticeProps?.maxSeconds).toBe(3600);
    await act(async () => data.noticeProps?.onStart());
    expect(data.start).toHaveBeenCalledWith(
      expect.objectContaining({
        meeting_type: "chapter",
        new_event: expect.objectContaining({ name: "Chapter meeting" }),
      }),
    );
    expect(router().push).toHaveBeenCalledWith({
      pathname: "/minutes-details",
      params: { id: "m-new" },
    });
    expect(data.recorderStart).toHaveBeenCalledWith(
      { meetingId: "m-new", eventName: "Chapter meeting", maxSeconds: 3600 },
      true,
    );
  });

  it("records into the member's own draft on the meeting on now", async () => {
    data.events = [
      {
        id: "e1",
        name: "Exec Meeting",
        start_time: iso(-10),
        end_time: iso(50),
      },
    ];
    data.meetings = [
      { id: "m-mine", event_id: "e1", status: "draft", created_by: "me" },
    ];
    render();
    await act(async () => latest.record?.onPress());
    await act(async () => data.noticeProps?.onStart());
    expect(data.start).not.toHaveBeenCalled();
    expect(data.clearRefusal).toHaveBeenCalled();
    expect(data.recorderStart).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: "m-mine",
        eventName: "Exec Meeting",
      }),
      true,
    );
  });

  it.each(["uploading", "transcribing", "ready"])(
    "opens the member's own draft without recording when its recording is %s",
    async (status) => {
      data.recordingStatus = status;
      data.events = [
        {
          id: "e1",
          name: "Exec Meeting",
          start_time: iso(-10),
          end_time: iso(50),
        },
      ];
      data.meetings = [
        { id: "m-mine", event_id: "e1", status: "draft", created_by: "me" },
      ];
      render();
      await act(async () => latest.record?.onPress());
      await act(async () => data.noticeProps?.onStart());
      expect(data.recorderStart).not.toHaveBeenCalled();
      expect(router().push).toHaveBeenCalledWith({
        pathname: "/minutes-details",
        params: { id: "m-mine" },
      });
      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining("already has a recording"),
      );
    },
  );

  it("stops picking a meeting whose minutes the server says already exist", async () => {
    data.events = [
      {
        id: "e1",
        name: "Chapter Meeting",
        start_time: iso(-10),
        end_time: iso(90),
      },
    ];
    data.start.mockRejectedValue({ code: "meeting.already_started" });
    render();
    await act(async () => latest.record?.onPress());
    await act(async () => data.noticeProps?.onStart());
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Someone else started minutes"),
    );
    expect(data.refetchMeetings).toHaveBeenCalled();
    expect(data.recorderStart).not.toHaveBeenCalled();
    expect(latest.record?.detail).toBe(
      "Chapter Meeting already has minutes. Open the event to take notes.",
    );
  });

  it("says why when the minutes can't start, and records nothing", async () => {
    data.start.mockRejectedValue(new Error("boom"));
    render();
    await act(async () => latest.record?.onPress());
    await act(async () => data.noticeProps?.onStart());
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't start"),
    );
    expect(data.recorderStart).not.toHaveBeenCalled();
  });
});

describe("New minutes", () => {
  it("starts the picked meeting and opens it, without the notice or the microphone", async () => {
    data.available = false;
    render();
    act(() => latest.newMinutes());
    expect(data.minutesPresent).toHaveBeenCalledTimes(1);
    expect(data.noticePresent).not.toHaveBeenCalled();
    await act(async () => data.startButton?.onPress());
    expect(data.start).toHaveBeenCalledWith(
      expect.objectContaining({ new_event: expect.anything() }),
    );
    expect(router().push).toHaveBeenCalledWith({
      pathname: "/minutes-details",
      params: { id: "m-new" },
    });
    expect(data.recorderStart).not.toHaveBeenCalled();
  });

  it("keeps the sheet open with the reason when the start fails", async () => {
    data.start.mockRejectedValue(new Error("offline"));
    const tree = render();
    act(() => latest.newMinutes());
    await act(async () => data.startButton?.onPress());
    expect(router().push).not.toHaveBeenCalled();
    const text = tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.props.children);
    expect(text.some((line) => String(line).startsWith("Couldn't start"))).toBe(
      true,
    );
  });

  it("can't start until the officer picks, when the meeting on now is taken", () => {
    data.events = [
      {
        id: "e1",
        name: "Chapter Meeting",
        start_time: iso(-10),
        end_time: iso(90),
      },
    ];
    data.meetings = [
      {
        id: "m-theirs",
        event_id: "e1",
        status: "posted",
        created_by: "president",
      },
    ];
    render();
    act(() => latest.newMinutes());
    expect(data.startButton?.disabled).toBe(true);
  });
});
