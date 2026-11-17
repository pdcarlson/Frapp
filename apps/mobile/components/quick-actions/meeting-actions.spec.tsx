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
 * recorder. The pick itself is `lib/minutes/start-minutes.spec.ts`'s.
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
  start: vi.fn(),
  consent: vi.fn(),
  refetchAvailability: vi.fn(),
  state: { phase: "idle", refusal: null } as unknown,
  hasRecorder: true,
  recorderStart: vi.fn(),
  noticePresent: vi.fn(),
  minutesPresent: vi.fn(),
  noticeProps: null as null | { onStart: () => void; maxSeconds: number },
  minutesProps: null as null | { onStart: () => Promise<void> },
}));

vi.mock("@repo/hooks", () => ({
  usePermissionList: () => data.permissions,
  useViewerUserId: () => "me",
  useEvents: (options: { enabled: boolean }) =>
    options.enabled
      ? { data: data.events, isSuccess: true }
      : { data: undefined, isSuccess: false },
  useMeetings: (options?: { enabled: boolean }) =>
    options?.enabled === false
      ? { data: undefined, isSuccess: false, refetch: vi.fn() }
      : { data: data.meetings, isSuccess: true, refetch: vi.fn() },
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
    recorder: data.hasRecorder ? { start: data.recorderStart } : null,
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
      return null;
    }),
  };
});

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
    expect(data.recorderStart).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: "m-mine",
        eventName: "Exec Meeting",
      }),
      true,
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
  it("opens its sheet and starts the picked meeting without the microphone", async () => {
    data.available = false;
    render();
    act(() => latest.newMinutes());
    expect(data.minutesPresent).toHaveBeenCalledTimes(1);
    expect(data.noticePresent).not.toHaveBeenCalled();
  });
});
