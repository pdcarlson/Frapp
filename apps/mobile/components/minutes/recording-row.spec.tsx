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
 * microphone; Stop and Delete ask first. The row's words per state are
 * `row-view.spec.ts`'s.
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
  props: null as { maxSeconds: number; onStart: () => void } | null,
}));
vi.mock("@/components/minutes/recording-notice-sheet", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    RecordingNoticeSheet: forwardRef(function RecordingNoticeSheet(
      props: { maxSeconds: number; onStart: () => void },
      ref,
    ) {
      notice.props = props;
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

import { RecordingRow } from "./recording-row";

const subject = {
  meetingId: "m1",
  eventName: "Chapter meeting",
  maxSeconds: 7200,
};
function server(over: Partial<MeetingRecordingState> = {}): MeetingRecordingState {
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
const onOpenNotes = vi.fn();

function render(
  state: RecorderState,
  serverState: MeetingRecordingState | null = server(),
): ReactTestRenderer {
  session.state = state;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <RecordingRow
          meetingId="m1"
          eventName="Chapter meeting"
          server={serverState}
          ensureConsent={ensureConsent}
          onOpenNotes={onOpenNotes}
        />
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
  session.hasRecorder = true;
  confirm.mockResolvedValue(true);
  ensureConsent.mockResolvedValue(true);
  remove.mockResolvedValue({});
  openSettings.mockResolvedValue(undefined);
});

describe("RecordingRow", () => {
  it("opens the notice on Record, and the microphone only on the notice's Start", async () => {
    const tree = render(IDLE);
    await press(tree, MEETING_RECORDER_COPY.record);
    expect(notice.present).toHaveBeenCalledTimes(1);
    expect(session.recorder.start).not.toHaveBeenCalled();

    expect(notice.props?.maxSeconds).toBe(7200);
    act(() => notice.props?.onStart());
    expect(session.recorder.start).toHaveBeenCalledWith(
      { meetingId: "m1", eventName: "Chapter meeting", maxSeconds: 7200 },
      true,
    );
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

  it("asks before a new recording replaces a transcript", async () => {
    const tree = render(
      IDLE,
      server({ status: "ready", transcript: "Speaker 1: Hello.", duration_seconds: 600 }),
    );
    confirm.mockResolvedValueOnce(false);
    await press(tree, MEETING_RECORDER_COPY.recordAgain);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: MEETING_RECORDER_COPY.replaceTitle }),
    );
    expect(notice.present).not.toHaveBeenCalled();
    await press(tree, MEETING_RECORDER_COPY.recordAgain);
    expect(notice.present).toHaveBeenCalledTimes(1);
  });

  it("shows the state and the clock in one label a screen reader says whole", () => {
    const tree = render(RECORDING);
    expect(screenText(tree)).toContain("Recording");
    expect(screenText(tree)).toContain("12:34");
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Recording, 12:34",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("pauses at once, and asks before Stop", async () => {
    const tree = render(RECORDING);
    await press(tree, MEETING_RECORDER_COPY.pause);
    expect(session.recorder.pause).toHaveBeenCalledTimes(1);

    confirm.mockResolvedValueOnce(false);
    await press(tree, MEETING_RECORDER_COPY.stop);
    expect(session.recorder.stop).not.toHaveBeenCalled();
    await press(tree, MEETING_RECORDER_COPY.stop);
    expect(session.recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("resumes a paused recording", async () => {
    const tree = render({ ...RECORDING, paused: "interrupted" } as RecorderState);
    await press(tree, MEETING_RECORDER_COPY.resume);
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

  it("shows the upload as a progress bar with its real value, and cancels it", async () => {
    const tree = render({
      phase: "uploading",
      subject,
      seconds: 3600,
      sent: 7_200_000,
      total: 28_800_000,
    });
    const bar = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "progressbar",
    )[0];
    expect(bar?.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 25 });
    await press(tree, MEETING_RECORDER_COPY.cancel);
    expect(session.recorder.cancelUpload).toHaveBeenCalledTimes(1);
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

  it("opens the notes for a ready transcript, and stops a transcription after asking", async () => {
    let tree = render(
      IDLE,
      server({ status: "ready", transcript: "Speaker 1: Hello.", duration_seconds: 600 }),
    );
    await press(tree, MEETING_RECORDER_COPY.openNotes);
    expect(onOpenNotes).toHaveBeenCalledTimes(1);

    tree = render(IDLE, server({ status: "transcribing", duration_seconds: 600 }));
    await press(tree, MEETING_RECORDER_COPY.stopTranscribing);
    expect(remove).toHaveBeenCalledWith({ id: "m1" });
  });

  it("on a build that can't record, shows what was uploaded elsewhere and offers no Record", () => {
    session.hasRecorder = false;
    expect(render(IDLE).toJSON()).toBeNull();

    const tree = render(
      IDLE,
      server({ status: "ready", transcript: "Speaker 1: Hello.", duration_seconds: 600 }),
    );
    expect(button(tree, MEETING_RECORDER_COPY.openNotes)).toBeDefined();
    expect(button(tree, MEETING_RECORDER_COPY.recordAgain)).toBeUndefined();
    const failed = render(IDLE, server({ status: "failed" }));
    expect(button(failed, MEETING_RECORDER_COPY.record)).toBeUndefined();
  });

  it("keeps the progress track in the layout when it has nothing to show", () => {
    const tree = render(IDLE);
    const tracks = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.importantForAccessibility === "no-hide-descendants",
    );
    expect(tracks).toHaveLength(1);
  });

  describe("with no answer from the server", () => {
    it("still gives a recording under way its clock, Pause and Stop", async () => {
      const tree = render(RECORDING, null);
      expect(screenText(tree)).toContain(MEETING_RECORDER_COPY.recording);
      await press(tree, MEETING_RECORDER_COPY.pause);
      expect(session.recorder.pause).toHaveBeenCalled();
      await press(tree, MEETING_RECORDER_COPY.stop);
      expect(session.recorder.stop).toHaveBeenCalled();
    });

    it("draws nothing, and offers no Record, when the phone holds nothing", () => {
      const tree = render(IDLE, null);
      expect(tree.toJSON()).toBeNull();
    });
  });
});
