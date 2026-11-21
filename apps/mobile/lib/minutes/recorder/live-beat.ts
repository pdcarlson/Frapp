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
 * recording"; `spec/behavior/meetings.md` § Where a draft stands): once when
 * the phone starts recording a meeting and every minute while it records,
 * and once more when it stops, so the Minutes list and the event's Minutes
 * row can say so. Each call is best effort: a missed beat only lets
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
    // One request at a time, in order: a beat still in flight when the
    // recording stops must not land after the DELETE and bring the line
    // back for three minutes with nobody recording.
    let queue: Promise<unknown> = Promise.resolve();
    const send = (call: () => Promise<unknown>) => {
      queue = queue.then(call).catch(() => undefined);
    };
    const beat = () =>
      send(() => client.PUT("/v1/meetings/{id}/live-recording", path));
    beat();
    const timer = setInterval(beat, LIVE_BEAT_MS);
    return () => {
      clearInterval(timer);
      send(() => client.DELETE("/v1/meetings/{id}/live-recording", path));
    };
  }, [client, meetingId]);
}
