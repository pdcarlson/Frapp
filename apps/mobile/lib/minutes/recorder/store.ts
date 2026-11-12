import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  RecorderIdentity,
  RecorderStore,
  StoredRecording,
} from "./controller";

/**
 * Where the phone writes down its meeting recordings, so a relaunch finds
 * the file whatever happened to the app (`controller.ts` § restore). One
 * record per member and chapter, so signing in as someone else, or opening
 * another chapter, never writes over a recording that hasn't been uploaded.
 * A record holds the file's place, whose it is, the meeting and the length
 * so far: no audio, no upload signature and nothing said in the meeting.
 */
const PREFIX = "frapp.meeting-recorder.v1:";

const keyOf = (identity: RecorderIdentity) =>
  `${PREFIX}${identity.userId}:${identity.chapterId}`;

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

function parse(raw: string | null): StoredRecording | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStored(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const recorderStore: RecorderStore = {
  /**
   * Every recording the phone remembers, whoever made it. Rejects when the
   * phone's storage can't be read, which is not the same as holding none:
   * the caller must not clear files on a failed read. A record that can't
   * be understood is dropped, since nothing could upload its file.
   */
  async all() {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
      key.startsWith(PREFIX),
    );
    const recordings: StoredRecording[] = [];
    for (const key of keys) {
      const recording = parse(await AsyncStorage.getItem(key));
      if (recording && keyOf(recording) === key) recordings.push(recording);
      else await AsyncStorage.removeItem(key).catch(() => undefined);
    }
    return recordings;
  },
  save: (recording) =>
    AsyncStorage.setItem(keyOf(recording), JSON.stringify(recording)),
  clear: (identity) => AsyncStorage.removeItem(keyOf(identity)),
};
