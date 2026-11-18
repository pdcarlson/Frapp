import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEETING_COPY } from "@repo/validation";

type Query = {
  isPending: boolean;
  isError?: boolean;
  data?: unknown;
  error?: unknown;
  refetch?: () => void;
};

const mocks = vi.hoisted(() => ({
  meeting: { current: {} as Query },
  recording: { current: {} as Query },
}));

vi.mock("@repo/hooks", () => ({
  useMeeting: () => mocks.meeting.current,
  useMeetingRecording: () => mocks.recording.current,
}));

import { TranscriptPage } from "./transcript-page";

const MEETING = {
  id: "m-1",
  event_name: "Cabinet Meeting",
  event_start_time: "2026-11-18T02:00:00Z",
  transcript: null as string | null,
};

function failure(status: number) {
  return Object.assign(new Error("failed"), { status });
}

beforeEach(() => {
  mocks.meeting.current = { isPending: false, data: MEETING };
  mocks.recording.current = { isPending: false, data: null };
});

describe("TranscriptPage", () => {
  it("reads a draft's transcript from its recording, each turn led by its speaker", () => {
    mocks.recording.current = {
      isPending: false,
      data: {
        status: "ready",
        transcript: "Speaker 1: Call to order.",
        duration_seconds: 4320,
      },
    };
    render(<TranscriptPage id="m-1" />);
    expect(screen.getByText("Cabinet Meeting")).toBeTruthy();
    expect(screen.getByText("Speaker 1")).toBeTruthy();
    expect(screen.getByText("Call to order.")).toBeTruthy();
  });

  it("falls back to posted minutes' own transcript when the recording is gone", () => {
    mocks.meeting.current = {
      isPending: false,
      data: { ...MEETING, transcript: "Speaker 2: Dues are due." },
    };
    render(<TranscriptPage id="m-1" />);
    expect(screen.getByText("Dues are due.")).toBeTruthy();
  });

  it("says there is none when neither has one", () => {
    render(<TranscriptPage id="m-1" />);
    expect(screen.getByText(MEETING_COPY.transcriptMissing)).toBeTruthy();
  });

  it("offers a retry, never 'no transcript', when the recording read fails", () => {
    const refetch = vi.fn();
    mocks.recording.current = {
      isPending: false,
      isError: true,
      error: failure(500),
      refetch,
    };
    render(<TranscriptPage id="m-1" />);
    expect(screen.queryByText(MEETING_COPY.transcriptMissing)).toBeNull();
    expect(screen.getByText(MEETING_COPY.loadFailedTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says the minutes are missing, with no retry, on a 404", () => {
    mocks.meeting.current = {
      isPending: false,
      data: undefined,
      error: failure(404),
      refetch: vi.fn(),
    };
    render(<TranscriptPage id="m-1" />);
    expect(screen.getByText(MEETING_COPY.missingTitle)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /try again|retry/i }),
    ).toBeNull();
  });
});
