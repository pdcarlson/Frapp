import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RecorderStore, StoredRecording } from "./controller";

/**
 * Where the phone writes down its one meeting recording, so a relaunch finds
 * the file whatever happened to the app (`controller.ts` § restore). It holds
 * the file's place, the meeting and the length so far: no audio, no upload
 * signature and nothing said in the meeting.
 */
const KEY = "frapp.meeting-recorder.v1";

function isStored(value: unknown): value is StoredRecording {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredRecording>;
  return (
    row.v === 1 &&
    typeof row.userId === "string" &&
    typeof row.chapterId === "string" &&
    typeof row.uri === "string" &&
    typeof row.startedAt === "number" &&
    typeof row.seconds === "number" &&
    (row.stage === "recording" || row.stage === "kept") &&
    typeof row.reason === "string" &&
    !!row.subject &&
    typeof row.subject.meetingId === "string" &&
    typeof row.subject.eventName === "string" &&
    typeof row.subject.maxSeconds === "number"
  );
}

export const recorderStore: RecorderStore = {
  async load() {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isStored(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  save: (recording) => AsyncStorage.setItem(KEY, JSON.stringify(recording)),
  clear: () => AsyncStorage.removeItem(KEY),
};
