/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MEETING_RECORDING_FAILURE_COPY,
  STANDARDS_MEETING_NOTE,
} from "@repo/validation";

const auth = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  chapterId: "chapter-1" as string | null,
}));
vi.mock("@/lib/auth-session", () => ({ useAuthSession: () => auth }));
const calls = vi.hoisted(() => ({
  start: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@repo/hooks", () => ({
  useStartMeetingRecording: () => ({ mutateAsync: calls.start }),
  useConfirmMeetingRecording: () => ({ mutateAsync: calls.confirm }),
  useRemoveMeetingRecording: () => ({ mutateAsync: calls.remove }),
}));
const device = vi.hoisted(() => ({ load: vi.fn(() => ({ fake: "device" })) }));
vi.mock("./device", () => ({ meetingRecorderDevice: device.load }));
const session = vi.hoisted(() => ({
  bind: vi.fn(),
  recorder: { setApi: vi.fn(), tick: vi.fn() },
}));
vi.mock("./session", () => ({ bindMeetingRecorder: session.bind }));
const betaOff = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("@repo/validation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/validation")>()),
  isBetaOffModule: (key: string) => betaOff.keys.includes(key),
}));

import type { RecorderApi } from "./controller";
import {
  describeRecordingRefusal,
  useMeetingRecorderRuntime,
} from "./use-recorder-runtime";

beforeEach(() => {
  vi.clearAllMocks();
  auth.userId = "user-1";
  auth.chapterId = "chapter-1";
  betaOff.keys = [];
  session.bind.mockReturnValue(session.recorder);
});

const api = () => session.recorder.setApi.mock.calls.at(-1)?.[0] as RecorderApi;

describe("useMeetingRecorderRuntime", () => {
  it("binds the recorder to the signed-in member's chapter and hands it the server calls", () => {
    renderHook(() => useMeetingRecorderRuntime());
    expect(session.bind).toHaveBeenCalledWith(
      { userId: "user-1", chapterId: "chapter-1" },
      { fake: "device" },
      expect.anything(),
    );
    expect(session.recorder.setApi).toHaveBeenCalledTimes(1);
  });

  it("binds none, and loads no audio module, when nobody is signed in to a chapter", () => {
    auth.chapterId = null;
    session.bind.mockReturnValue(null);
    renderHook(() => useMeetingRecorderRuntime());
    expect(session.bind).toHaveBeenCalledWith(null, null, expect.anything());
    expect(device.load).not.toHaveBeenCalled();
  });

  it("does nothing at all while meetings are off for the beta", () => {
    betaOff.keys = ["meetings"];
    renderHook(() => useMeetingRecorderRuntime());
    expect(session.bind).not.toHaveBeenCalled();
    expect(device.load).not.toHaveBeenCalled();
  });

  it("uploads through the web's routes: start, then uploaded, or remove to give up", async () => {
    renderHook(() => useMeetingRecorderRuntime());
    calls.start.mockResolvedValue({
      upload: {
        upload_id: "upload-1",
        bucket: "meeting-recordings",
        path: "c/m/u.aac",
        token: "signed",
        content_type: "audio/aac",
      },
    });
    const file = {
      file_name: "Recorded in Frapp.aac",
      mime_type: "audio/aac",
      size_bytes: 10,
      duration_seconds: 60,
      notice_confirmed: true as const,
    };
    expect(await api().start("m1", file)).toEqual({
      uploadId: "upload-1",
      bucket: "meeting-recordings",
      path: "c/m/u.aac",
      token: "signed",
      contentType: "audio/aac",
    });
    expect(calls.start).toHaveBeenCalledWith({ id: "m1", body: file });

    await api().confirm("m1", "upload-1");
    expect(calls.confirm).toHaveBeenCalledWith({ id: "m1", uploadId: "upload-1" });
    await api().abandon("m1", "upload-1");
    expect(calls.remove).toHaveBeenCalledWith({ id: "m1", uploadId: "upload-1" });
  });

  it("refuses a start that came back with nowhere to upload to", async () => {
    renderHook(() => useMeetingRecorderRuntime());
    calls.start.mockResolvedValue({ upload: null });
    await expect(
      api().start("m1", {
        file_name: "a.aac",
        mime_type: "audio/aac",
        size_bytes: 1,
        duration_seconds: 60,
        notice_confirmed: true,
      }),
    ).rejects.toThrow();
  });
});

/** A refused upload says why in the words the web's upload step uses. */
describe("describeRecordingRefusal", () => {
  const refusal = (code: string) => ({ statusCode: 400, code });

  it.each([
    ["meeting.standards_refused", STANDARDS_MEETING_NOTE],
    ["ai.consent.required", MEETING_RECORDING_FAILURE_COPY.consent_required],
    ["ai.chapter_off", MEETING_RECORDING_FAILURE_COPY.chapter_off],
    ["meeting.recording_unavailable", MEETING_RECORDING_FAILURE_COPY.unavailable],
  ])("says %s in plain words", (code, words) => {
    expect(describeRecordingRefusal(refusal(code))).toBe(words);
  });

  it("leaves a refusal it has no words for to the row's own line", () => {
    expect(describeRecordingRefusal(new Error("boom"))).toBeNull();
  });
});
