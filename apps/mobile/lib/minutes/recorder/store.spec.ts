import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredRecording } from "./controller";
import { recorderStore } from "./store";

/**
 * What the phone writes down about its recordings, one per member and
 * chapter. It is read on every launch, so anything that isn't a whole,
 * current record reads as none.
 */
const KEY = "frapp.meeting-recorder.v1:user-1:chapter-1";
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

// The suite's AsyncStorage is a set of stubs; give these four a memory.
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  vi.mocked(AsyncStorage.getItem).mockImplementation(
    async (key) => memory.get(key) ?? null,
  );
  vi.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    memory.set(key, value);
  });
  vi.mocked(AsyncStorage.getAllKeys).mockImplementation(async () => [
    ...memory.keys(),
  ]);
  vi.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => {
    memory.delete(key);
  });
});

describe("recorderStore", () => {
  it("reads back what it saved, and nothing once cleared", async () => {
    expect(await recorderStore.all()).toEqual([]);
    await recorderStore.save(recording);
    expect(await recorderStore.all()).toEqual([recording]);
    await recorderStore.clear({ userId: "user-1", chapterId: "chapter-1" });
    expect(await recorderStore.all()).toEqual([]);
  });

  it("keeps one recording per member and chapter, and leaves other keys alone", async () => {
    const theirs = { ...recording, userId: "user-2" };
    const elsewhere = { ...recording, chapterId: "chapter-2" };
    memory.set("some-other-setting", "1");
    await recorderStore.save(recording);
    await recorderStore.save(theirs);
    await recorderStore.save(elsewhere);
    expect(await recorderStore.all()).toHaveLength(3);
    await recorderStore.clear(theirs);
    expect(await recorderStore.all()).toEqual([recording, elsewhere]);
    expect(memory.has("some-other-setting")).toBe(true);
  });

  it("rejects when the phone's storage can't be read", async () => {
    vi.mocked(AsyncStorage.getAllKeys).mockRejectedValueOnce(new Error("no"));
    await expect(recorderStore.all()).rejects.toThrow();
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
  ])("reads %s as no recording, and drops it", async (_name, raw) => {
    await AsyncStorage.setItem(KEY, raw);
    expect(await recorderStore.all()).toEqual([]);
    expect(memory.has(KEY)).toBe(false);
  });
});
