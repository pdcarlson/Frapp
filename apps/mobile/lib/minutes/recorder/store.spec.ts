import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredRecording } from "./controller";
import { recorderStore } from "./store";

/**
 * What the phone writes down about its one recording. It is read on every
 * launch, so anything that isn't a whole, current record reads as none.
 */
const KEY = "frapp.meeting-recorder.v1";
const recording: StoredRecording = {
  v: 1,
  userId: "user-1",
  chapterId: "chapter-1",
  subject: { meetingId: "meeting-1", eventName: "Chapter meeting", maxSeconds: 7200 },
  uri: "file:///documents/ExpoAudio/recording-1.aac",
  startedAt: 1,
  seconds: 30,
  stage: "recording",
  reason: "stopped",
};

// The suite's AsyncStorage is a set of stubs; give these three a memory.
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  vi.mocked(AsyncStorage.getItem).mockImplementation(
    async (key) => memory.get(key) ?? null,
  );
  vi.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    memory.set(key, value);
  });
  vi.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => {
    memory.delete(key);
  });
});

describe("recorderStore", () => {
  it("reads back what it saved, and nothing once cleared", async () => {
    expect(await recorderStore.load()).toBeNull();
    await recorderStore.save(recording);
    expect(await recorderStore.load()).toEqual(recording);
    await recorderStore.clear();
    expect(await recorderStore.load()).toBeNull();
  });

  it("holds the file's place and length, and no upload signature", async () => {
    await recorderStore.save(recording);
    const raw = (await AsyncStorage.getItem(KEY)) ?? "";
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual([
      "chapterId",
      "reason",
      "seconds",
      "stage",
      "startedAt",
      "subject",
      "uri",
      "userId",
      "v",
    ]);
  });

  it.each([
    ["not JSON", "{"],
    ["another version", JSON.stringify({ ...recording, v: 2 })],
    ["a missing file", JSON.stringify({ ...recording, uri: undefined })],
    ["a missing meeting", JSON.stringify({ ...recording, subject: {} })],
    ["an unknown stage", JSON.stringify({ ...recording, stage: "uploading" })],
  ])("reads %s as no recording", async (_name, raw) => {
    await AsyncStorage.setItem(KEY, raw);
    expect(await recorderStore.load()).toBeNull();
  });
});
