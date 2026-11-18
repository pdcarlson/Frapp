/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import type { MeetingRecordingState } from "@repo/hooks";
import { MEETING_RECORDER_COPY } from "@repo/validation";
import type { RecorderState } from "@/lib/minutes/recorder/machine";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * The recorder on a meeting's minutes, as the secretary uses it: Record
 * opens the notice and nothing else; only the notice's Start opens the
 * microphone; pause and stop are two round icons that never trade places;
 * Stop and Delete ask first; after Stop the steps show where the recording
 * is. The words per state are `row-view.spec.ts`'s.
 */
const session = vi.hoisted(() => ({
  state: { phase: "idle", refusal: null } as unknown,
  hasRecorder: true,
  recorder: {
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    upload: vi.fn(),
    cancelUpload: vi.fn(),
    discard: vi.fn(),
    clearRefusal: vi.fn(),
  },
}));
vi.mock("@/lib/minutes/recorder/session", () => ({
  useMeetingRecorder: () => ({
    state: session.state,
    recorder: session.hasRecorder ? session.recorder : null,
  }),
}));
const meter = vi.hoisted(() => ({
  level: null as null | (() => number | null),
}));
vi.mock("@/lib/minutes/recorder/device", () => ({
  meetingRecorderDevice: () => (meter.level ? { level: meter.level } : null),
}));
const openSettings = vi.hoisted(() => vi.fn());
vi.mock("react-native", async () => {
  const { reactNativeStub } = await import("@/test/react-native-stub");
  return { ...reactNativeStub, Linking: { openSettings } };
});
const remove = vi.hoisted(() => vi.fn());
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRemoveMeetingRecording: () => ({ mutateAsync: remove, isPending: false }),
}));
const notice = vi.hoisted(() => ({
  present: vi.fn(),
  rendered:
    vi.fn<(props: { maxSeconds: number; onStart: () => void }) => void>(),
}));
const noticeProps = () => notice.rendered.mock.lastCall?.[0];
vi.mock("@/components/minutes/recording-notice-sheet", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    RecordingNoticeSheet: forwardRef(function RecordingNoticeSheet(
      props: { maxSeconds: number; onStart: () => void },
      ref,
    ) {
      notice.rendered(props);
      useImperativeHandle(ref, () => ({ present: notice.present }));
      return null;
    }),
  };
});
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/lib/minutes/meetings-on", () => ({ confirmAlert: confirm }));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

import {
  RecorderControls,
  RecorderStage,
  useMeetingRecorderRow,
} from "./recorder";
import { recordingPipeline } from "@/lib/minutes/recorder/row-view";

const subject = {
  meetingId: "m1",
  eventName: "Chapter meeting",
  maxSeconds: 7200,
};
function server(
  over: Partial<MeetingRecordingState> = {},
): MeetingRecordingState {
  return {
    status: "none",
    available: true,
    blocked: null,
    max_bytes: 200 * 1024 * 1024,
    max_seconds: 7200,
    transcript: null,
    duration_seconds: null,
    failure_message: null,
    upload_id: null,
    ...over,
  } as MeetingRecordingState;
}
const ensureConsent = vi.fn();

/** The minutes screen's use of the recorder: stage on the page, controls pinned. */
function Harness({
  server: serverState,
  autoRecord = false,
}: {
  server: MeetingRecordingState | null;
  autoRecord?: boolean;
}) {
  const row = useMeetingRecorderRow({
    meetingId: "m1",
    eventName: "Chapter meeting",
    server: serverState,
    ensureConsent,
    autoRecord,
  });
  if (!row.shown) return null;
  const steps = recordingPipeline(
    "m1",
    session.state as RecorderState,
    serverState,
    { drafting: false },
  );
  return (
    <>
      <RecorderStage row={row} steps={steps} />
      <RecorderControls row={row} />
      {row.sheets}
    </>
  );
}

function render(
  state: RecorderState,
  serverState: MeetingRecordingState | null = server(),
  autoRecord = false,
): ReactTestRenderer {
  session.state = state;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Harness server={serverState} autoRecord={autoRecord} />
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
const press = (tree: ReactTestRenderer, label: string) =>
  act(async () => button(tree, label).props.onPress());

const IDLE: RecorderState = { phase: "idle", refusal: null };
const RECORDING: RecorderState = {
  phase: "recording",
  subject,
  seconds: 754,
  paused: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  meter.level = null;
  session.hasRecorder = true;
  confirm.mockResolvedValue(true);
  ensureConsent.mockResolvedValue(true);
  remove.mockResolvedValue({});
  openSettings.mockResolvedValue(undefined);
});

describe("the recorder on the minutes screen", () => {
  it("opens the notice on Record, and the microphone only on the notice's Start", async () => {
    const tree = render(IDLE);
    await press(tree, MEETING_RECORDER_COPY.record);
    expect(notice.present).toHaveBeenCalledTimes(1);
    expect(session.recorder.start).not.toHaveBeenCalled();

    expect(noticeProps()?.maxSeconds).toBe(7200);
    act(() => noticeProps()?.onStart());
    expect(session.recorder.start).toHaveBeenCalledWith(
      { meetingId: "m1", eventName: "Chapter meeting", maxSeconds: 7200 },
      true,
    );
  });

  it("asks to record by itself once when opened from a Record button", () => {
    render(IDLE, server(), true);
    expect(notice.present).toHaveBeenCalledTimes(1);
  });

  it("asks nothing by itself where the server offers no recording", () => {
    render(IDLE, null, true);
    expect(notice.present).not.toHaveBeenCalled();
  });

  it("asks the AI question first where it hasn't been answered, and a No opens nothing", async () => {
    const tree = render(IDLE, server({ blocked: "consent_required" }));
    ensureConsent.mockResolvedValueOnce(false);
    await press(tree, MEETING_RECORDER_COPY.record);
    expect(notice.present).not.toHaveBeenCalled();
    await press(tree, MEETING_RECORDER_COPY.record);
    expect(ensureConsent).toHaveBeenCalledTimes(2);
    expect(notice.present).toHaveBeenCalledTimes(1);
  });

  it("opens nothing when the consent check itself fails", async () => {
    const tree = render(IDLE, server({ blocked: "consent_required" }));
    ensureConsent.mockRejectedValueOnce(new Error("offline"));
    await press(tree, MEETING_RECORDER_COPY.record);
    expect(notice.present).not.toHaveBeenCalled();
  });

  it("offers no second recording once there is a transcript", () => {
    const tree = render(
      IDLE,
      server({
        status: "ready",
        transcript: "Speaker 1: Hello.",
        duration_seconds: 600,
      }),
    );
    expect(button(tree, MEETING_RECORDER_COPY.record)).toBeUndefined();
  });

  it("shows a big clock, and says the state and the clock in one label", () => {
    const tree = render(RECORDING);
    expect(screenText(tree)).toContain("12:34");
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Recording, 12:34",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("pauses at once from its icon, and asks before Stop", async () => {
    const tree = render(RECORDING);
    await press(tree, MEETING_RECORDER_COPY.pauseControl);
    expect(session.recorder.pause).toHaveBeenCalledTimes(1);

    confirm.mockResolvedValueOnce(false);
    await press(tree, MEETING_RECORDER_COPY.stopControl);
    expect(session.recorder.stop).not.toHaveBeenCalled();
    await press(tree, MEETING_RECORDER_COPY.stopControl);
    expect(session.recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps pause-or-carry-on first and stop second, paused or not", async () => {
    const order = (tree: ReactTestRenderer) =>
      tree.root
        .findAll(
          (node) =>
            typeof node.type === "string" &&
            typeof node.props.onPress === "function" &&
            typeof node.props.accessibilityLabel === "string",
        )
        .map((node) => node.props.accessibilityLabel as string);
    expect(order(render(RECORDING))).toEqual([
      MEETING_RECORDER_COPY.pauseControl,
      MEETING_RECORDER_COPY.stopControl,
    ]);
    const paused = render({ ...RECORDING, paused: "user" } as RecorderState);
    expect(order(paused)).toEqual([
      MEETING_RECORDER_COPY.resumeControl,
      MEETING_RECORDER_COPY.stopControl,
    ]);
    await press(paused, MEETING_RECORDER_COPY.resumeControl);
    expect(session.recorder.resume).toHaveBeenCalledTimes(1);
  });

  it("sends a kept recording, and deletes one only after asking", async () => {
    const tree = render({
      phase: "kept",
      subject,
      seconds: 3600,
      bytes: 28_800_000,
      reason: "upload_failed",
      message: null,
    });
    await press(tree, MEETING_RECORDER_COPY.tryAgain);
    expect(session.recorder.upload).toHaveBeenCalledTimes(1);

    confirm.mockResolvedValueOnce(false);
    await press(tree, MEETING_RECORDER_COPY.delete);
    expect(session.recorder.discard).not.toHaveBeenCalled();
    await press(tree, MEETING_RECORDER_COPY.delete);
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ destructive: true }),
    );
    expect(session.recorder.discard).toHaveBeenCalledTimes(1);
  });

  it("ticks off Recorded, shows the upload's real progress, and cancels it", async () => {
    const tree = render({
      phase: "uploading",
      subject,
      seconds: 3600,
      sent: 7_200_000,
      total: 28_800_000,
    });
    expect(
      tree.root.findAll(
        (node) =>
          node.props.accessibilityLabel ===
          `${MEETING_RECORDER_COPY.steps.recorded}, done`,
      ).length,
    ).toBeGreaterThan(0);
    const bar = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "progressbar",
    )[0];
    expect(bar?.props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 25,
    });
    await press(tree, MEETING_RECORDER_COPY.cancel);
    expect(session.recorder.cancelUpload).toHaveBeenCalledTimes(1);
  });

  it("shows transcribing as the step under way, and stops it after asking", async () => {
    const tree = render(
      IDLE,
      server({ status: "transcribing", duration_seconds: 600 }),
    );
    expect(
      tree.root.findAll(
        (node) =>
          node.props.accessibilityLabel ===
          `${MEETING_RECORDER_COPY.stepsRunning.transcribed}, in progress`,
      ).length,
    ).toBeGreaterThan(0);
    await press(tree, MEETING_RECORDER_COPY.stopTranscribing);
    expect(remove).toHaveBeenCalledWith({ id: "m1" });
  });

  it("opens Settings for a denied microphone", async () => {
    const tree = render({
      phase: "idle",
      refusal: { kind: "microphone_denied", meetingId: "m1" },
    });
    expect(screenText(tree)).toContain(MEETING_RECORDER_COPY.microphoneDenied);
    await press(tree, MEETING_RECORDER_COPY.openSettings);
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("goes to the meeting whose recording the phone is holding", async () => {
    const tree = render({
      ...RECORDING,
      subject: { ...subject, meetingId: "m2", eventName: "Exec meeting" },
    } as RecorderState);
    expect(screenText(tree)).toContain(
      MEETING_RECORDER_COPY.elsewhere("Exec meeting"),
    );
    await press(tree, MEETING_RECORDER_COPY.openElsewhere);
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/minutes-details",
      params: { id: "m2" },
    });
  });

  it("on a build that can't record, offers no Record", () => {
    session.hasRecorder = false;
    expect(render(IDLE).toJSON()).toBeNull();
    const failed = render(IDLE, server({ status: "failed" }));
    expect(button(failed, MEETING_RECORDER_COPY.record)).toBeUndefined();
  });

  describe("with no answer from the server", () => {
    it("still gives a recording under way its clock, pause and stop", async () => {
      const tree = render(RECORDING, null);
      expect(screenText(tree)).toContain("12:34");
      await press(tree, MEETING_RECORDER_COPY.pauseControl);
      expect(session.recorder.pause).toHaveBeenCalled();
      await press(tree, MEETING_RECORDER_COPY.stopControl);
      expect(session.recorder.stop).toHaveBeenCalled();
    });

    it("draws nothing, and offers no Record, when the phone holds nothing", () => {
      const tree = render(IDLE, null);
      expect(tree.toJSON()).toBeNull();
    });
  });
});

describe("The recorder bar's live level (#5288)", () => {
  /** The level's bars, by the height each is drawn at. */
  const heights = (tree: ReactTestRenderer) =>
    tree.root
      .findAll(
        (node) =>
          (node.type as unknown) === "View" &&
          Array.isArray(node.props.style) &&
          node.props.style.some(
            (part: unknown) =>
              !!part &&
              typeof part === "object" &&
              "height" in part &&
              "backgroundColor" in part,
          ),
      )
      .map((node) =>
        (node.props.style as { height?: number }[]).reduce(
          (height, part) => part?.height ?? height,
          0,
        ),
      );

  it("rises with what the microphone hears while it records", () => {
    vi.useFakeTimers();
    try {
      meter.level = () => 1;
      const tree = render(RECORDING);
      const quiet = Math.max(...heights(tree));
      act(() => vi.advanceTimersByTime(360));
      expect(Math.max(...heights(tree))).toBeGreaterThan(quiet);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lies flat while paused, and reads nothing", () => {
    vi.useFakeTimers();
    try {
      meter.level = vi.fn(() => 1);
      const tree = render({ ...RECORDING, paused: "user" } as RecorderState);
      const flat = Math.max(...heights(tree));
      act(() => vi.advanceTimersByTime(360));
      expect(Math.max(...heights(tree))).toBe(flat);
      expect(meter.level).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
