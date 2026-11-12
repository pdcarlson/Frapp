import { useSyncExternalStore } from "react";
import {
  MeetingRecorderController,
  type RecorderDevice,
  type RecorderIdentity,
  type RecorderStore,
} from "./controller";
import { IDLE, type RecorderState } from "./machine";

/**
 * The phone's one meeting recorder, held outside the screens.
 *
 * A recording runs for two hours while the officer reads chat, locks the
 * phone and comes back, so it can't belong to the minutes screen that
 * started it. There is one controller per signed-in member and chapter
 * (`bindMeetingRecorder`, called by `useMeetingRecorderRuntime` from
 * `AppRuntime`); the minutes screen's row and the bar over every other
 * screen read the same one through `useMeetingRecorder`.
 *
 * Signing out or switching chapter ends that session's recorder: a
 * recording under way is closed and kept on the phone, and is found again
 * when the same member is back in the same chapter.
 */
let current: {
  key: string;
  controller: MeetingRecorderController;
  off: () => void;
} | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const keyOf = (identity: RecorderIdentity) =>
  `${identity.userId}:${identity.chapterId}`;

/**
 * Make `identity`'s recorder the phone's recorder, or none when `identity`
 * is null (signed out, no chapter, a build that can't record).
 */
export function bindMeetingRecorder(
  identity: RecorderIdentity | null,
  device: RecorderDevice | null,
  store: RecorderStore,
): MeetingRecorderController | null {
  const key = identity && device ? keyOf(identity) : null;
  if (current && current.key === key) return current.controller;
  if (current) {
    current.off();
    current.controller.dispose();
    current = null;
  }
  if (identity && device && key) {
    const controller = new MeetingRecorderController(identity, device, store);
    current = { key, controller, off: controller.subscribe(notify) };
    void controller.restore();
  }
  notify();
  return current?.controller ?? null;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const snapshot = (): RecorderState => current?.controller.getState() ?? IDLE;
const controllerSnapshot = () => current?.controller ?? null;

/**
 * Is the recorder in the middle of something a reload would cut off: asking
 * the server to start, recording (also in the background, with the phone
 * locked), closing the file, or uploading it? Read outside React by
 * `lib/updates/use-resume-updates.ts`, which never reloads into an update
 * then.
 */
export function isMeetingRecorderBusy(): boolean {
  const { phase } = snapshot();
  return (
    phase === "starting" ||
    phase === "recording" ||
    phase === "saving" ||
    phase === "uploading"
  );
}

/** What the phone's recorder is doing, and the recorder itself when there is one. */
export function useMeetingRecorder(): {
  state: RecorderState;
  recorder: MeetingRecorderController | null;
} {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const recorder = useSyncExternalStore(
    subscribe,
    controllerSnapshot,
    controllerSnapshot,
  );
  return { state, recorder };
}
