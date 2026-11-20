import { useEffect } from "react";
import { useFrappClient } from "@repo/hooks";
import type { RecorderState } from "./machine";
import { useMeetingRecorder } from "./session";

/** How often a recording phone tells the server it is still recording. */
export const LIVE_BEAT_MS = 60_000;

/** The minutes this phone is recording right now, else null. */
export function liveRecordingMeetingId(state: RecorderState): string | null {
  return state.phase === "starting" || state.phase === "recording"
    ? state.subject.meetingId
    : null;
}

/**
 * Tells the server who is recording (Paul, 2026-11-20: "Winston Hewitt is
 * recording"; `spec/behavior/meetings.md` § Recording in the app): once when
 * the phone starts recording a meeting and every minute while it records,
 * and once more when it stops, so the Minutes list, the event's Minutes card
 * and Activity can say so. Each call is best effort: a missed beat only lets
 * the line lapse after three minutes, and a recording never waits on one.
 * Nothing about the recording goes with it, only which minutes.
 */
export function useLiveRecordingBeat(enabled: boolean): void {
  const client = useFrappClient();
  const { state } = useMeetingRecorder();
  const meetingId = enabled ? liveRecordingMeetingId(state) : null;
  useEffect(() => {
    if (!meetingId) return;
    const path = { params: { path: { id: meetingId } } };
    const beat = () => {
      void client
        .PUT("/v1/meetings/{id}/live-recording", path)
        .catch(() => undefined);
    };
    beat();
    const timer = setInterval(beat, LIVE_BEAT_MS);
    return () => {
      clearInterval(timer);
      void client
        .DELETE("/v1/meetings/{id}/live-recording", path)
        .catch(() => undefined);
    };
  }, [client, meetingId]);
}
