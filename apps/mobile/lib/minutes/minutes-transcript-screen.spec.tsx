/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { MEETING_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * A meeting's transcript on its own screen (Paul, 2026-11-18). Renders
 * `app/(app)/minutes-transcript.tsx` from here, since a spec under `app/`
 * ships as a route module.
 */
type Query = {
  isPending: boolean;
  isError?: boolean;
  isFetching?: boolean;
  data?: unknown;
  error?: unknown;
  refetch: () => void;
};
const state = vi.hoisted(() => ({
  meeting: {} as Query,
  recording: {} as Query,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMeeting: () => state.meeting,
  useMeetingRecording: () => state.recording,
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

vi.mock("@/components/inline-note", () => ({
  InlineNote: ({ children }: { children: React.ReactNode }) =>
    React.createElement("Text", null, children),
}));

import MinutesTranscriptScreen from "@/app/(app)/minutes-transcript";

const MEETING = {
  id: "m1",
  event_name: "Cabinet Meeting",
  transcript: null as string | null,
};
const failure = (status: number) =>
  Object.assign(new Error("failed"), { status });

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MinutesTranscriptScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({ id: "m1" });
  state.meeting = { isPending: false, data: MEETING, refetch: vi.fn() };
  state.recording = { isPending: false, data: null, refetch: vi.fn() };
});

describe("Transcript screen", () => {
  it("reads a draft's transcript from its recording", () => {
    state.recording = {
      isPending: false,
      data: {
        status: "ready",
        transcript: "Speaker 1: Call to order.",
        duration_seconds: 4320,
      },
      refetch: vi.fn(),
    };
    expect(drawnText(render().root)).toContain("Speaker 1  Call to order.");
  });

  it("falls back to posted minutes' own transcript", () => {
    state.meeting = {
      isPending: false,
      data: { ...MEETING, transcript: "Speaker 2: Dues are due." },
      refetch: vi.fn(),
    };
    expect(drawnText(render().root)).toContain("Speaker 2  Dues are due.");
  });

  it("says there is none when neither has one", () => {
    expect(screenText(render())).toContain(MEETING_COPY.transcriptMissing);
  });

  it("offers a retry, never 'no transcript', when the recording read fails", () => {
    state.recording = {
      isPending: false,
      isError: true,
      error: failure(500),
      refetch: vi.fn(),
    };
    const text = screenText(render());
    expect(text).not.toContain(MEETING_COPY.transcriptMissing);
    expect(text).toContain(MEETING_COPY.loadFailedTitle);
  });

  it("says the minutes are missing on a 404", () => {
    state.meeting = {
      isPending: false,
      data: undefined,
      error: failure(404),
      refetch: vi.fn(),
    };
    expect(screenText(render())).toContain(MEETING_COPY.missingTitle);
  });

  it("never spins forever when opened without an id", () => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
    state.meeting = { isPending: true, refetch: vi.fn() };
    expect(screenText(render())).toContain(MEETING_COPY.missingBody);
  });
});
