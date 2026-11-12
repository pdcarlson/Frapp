import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";

const constantsState = vi.hoisted(() => ({ executionEnvironment: "standalone" }));
vi.mock("expo-constants", () => ({
  default: {
    get executionEnvironment() {
      return constantsState.executionEnvironment;
    },
  },
  ExecutionEnvironment: {
    Bare: "bare",
    Standalone: "standalone",
    StoreClient: "storeClient",
  },
}));

import {
  createRecorderDevice,
  meetingRecorderDevice,
  resetMeetingRecorderDeviceForTests,
  setRecorderModulesLoaderForTests,
} from "./device";
import type { RecorderNativeModules } from "./native-types";

/**
 * The recorder's device layer over fakes of `expo-audio` and
 * `expo-file-system`. What a phone does with these calls is on the device
 * list in the PR; what is pinned here is which calls are made, in which
 * order, and with what, since each was chosen against the module's source.
 */
const DOCS = "file:///documents";

function fakeModules() {
  const disk = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const listeners: ((status: { isFinished: boolean }) => void)[] = [];
  const recorder = {
    uri: `${DOCS}/ExpoAudio/recording-1.aac` as string | null,
    options: null as Record<string, unknown> | null,
    status: { isRecording: false, durationMillis: 0, url: null as string | null },
    prepareToRecordAsync: vi.fn(async (...args: unknown[]) => {
      calls.push(`prepare:${args.length}`);
    }),
    record: vi.fn(() => {
      calls.push("record");
      recorder.status.isRecording = true;
    }),
    pause: vi.fn(() => {
      recorder.status.isRecording = false;
    }),
    stop: vi.fn(async () => {
      calls.push("stop");
      recorder.status.isRecording = false;
    }),
    getStatus: vi.fn(() => ({ ...recorder.status })),
    addListener: vi.fn(
      (_event: string, listener: (status: { isFinished: boolean }) => void) => {
        listeners.push(listener);
        return { remove: () => void listeners.splice(listeners.indexOf(listener), 1) };
      },
    ),
    release: vi.fn(() => void calls.push("release")),
  };
  const permissions = { microphone: true, notifications: true };
  const audio = {
    AudioModule: {
      AudioRecorder: vi.fn(function (options: Record<string, unknown>) {
        recorder.options = options;
        return recorder;
      }) as unknown as RecorderNativeModules["audio"]["AudioModule"]["AudioRecorder"],
    },
    setAudioModeAsync: vi.fn(async (mode: Record<string, unknown>) => {
      calls.push(`mode:${String(mode.allowsRecording)}`);
    }),
    setIsAudioActiveAsync: vi.fn(async () => undefined),
    requestRecordingPermissionsAsync: vi.fn(async () => ({
      granted: permissions.microphone,
    })),
    requestNotificationPermissionsAsync: vi.fn(async () => ({
      granted: permissions.notifications,
    })),
  };

  const uriOf = (parts: unknown[]) =>
    parts
      .map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri))
      .join("/");
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = uriOf(parts);
    }
    get name() {
      return this.uri.slice(this.uri.lastIndexOf("/") + 1);
    }
    get exists() {
      return disk.has(this.uri);
    }
    get size() {
      return disk.get(this.uri)?.length ?? null;
    }
    delete() {
      disk.delete(this.uri);
    }
    open() {
      const bytes = disk.get(this.uri) ?? new Uint8Array();
      const handle = {
        offset: 0 as number | null,
        readBytes: (length: number) =>
          bytes.slice(handle.offset ?? 0, (handle.offset ?? 0) + length),
        close: vi.fn(),
      };
      return handle;
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = uriOf(parts);
    }
    get exists() {
      return [...disk.keys()].some((uri) => uri.startsWith(`${this.uri}/`));
    }
    list() {
      return [...disk.keys()]
        .filter((uri) => uri.startsWith(`${this.uri}/`))
        .map((uri) => new File(uri));
    }
  }
  const space = { free: 5_000_000_000 };
  const files = {
    File,
    Directory,
    Paths: {
      document: { uri: DOCS, exists: true, list: () => [] },
      get availableDiskSpace() {
        return space.free;
      },
    },
  } as unknown as RecorderNativeModules["files"];

  return {
    modules: { audio, files } as RecorderNativeModules,
    audio,
    recorder,
    disk,
    calls,
    listeners,
    permissions,
    space,
  };
}

beforeEach(() => {
  Platform.OS = "ios";
  constantsState.executionEnvironment = "standalone";
  setRecorderModulesLoaderForTests(null);
  resetMeetingRecorderDeviceForTests();
});

describe("createRecorderDevice", () => {
  it("opens the session for background recording, then prepares with no options and records", async () => {
    const fake = fakeModules();
    const device = createRecorderDevice(fake.modules);
    const { uri } = await device.begin();
    expect(uri).toBe(`${DOCS}/ExpoAudio/recording-1.aac`);
    expect(fake.audio.setAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        allowsRecording: true,
        allowsBackgroundRecording: true,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
      }),
    );
    // Options passed to prepare make iOS open a second file.
    expect(fake.calls).toEqual(["mode:true", "prepare:0", "record"]);
  });

  it("records one channel of speech-quality ADTS AAC into the app's documents", async () => {
    const fake = fakeModules();
    await createRecorderDevice(fake.modules).begin();
    expect(fake.recorder.options).toMatchObject({
      extension: ".aac",
      numberOfChannels: 1,
      sampleRate: 44100,
      bitRate: 64000,
      directory: "document",
    });
  });

  it("falls back to the status for the file's place, and fails without one", async () => {
    const fake = fakeModules();
    fake.recorder.uri = null;
    fake.recorder.status.url = `${DOCS}/Audio/recording-2.aac`;
    const device = createRecorderDevice(fake.modules);
    expect((await device.begin()).uri).toBe(`${DOCS}/Audio/recording-2.aac`);
    fake.recorder.status.url = null;
    await expect(device.begin()).rejects.toThrow();
  });

  it("asks for the microphone, and for the notification only on Android", async () => {
    const fake = fakeModules();
    const device = createRecorderDevice(fake.modules);
    expect(await device.microphone()).toBe("granted");
    fake.permissions.microphone = false;
    expect(await device.microphone()).toBe("denied");

    expect(await device.backgroundAllowed()).toBe(true);
    // expo-audio's request throws on iOS, so it must not be made there.
    expect(fake.audio.requestNotificationPermissionsAsync).not.toHaveBeenCalled();
    Platform.OS = "android";
    fake.permissions.notifications = false;
    expect(await device.backgroundAllowed()).toBe(false);
  });

  it("reads the clock in seconds, and nothing when there is no recorder", async () => {
    const fake = fakeModules();
    const device = createRecorderDevice(fake.modules);
    expect(device.status()).toBeNull();
    await device.begin();
    fake.recorder.status.durationMillis = 61_500;
    expect(device.status()).toEqual({ isRecording: true, seconds: 61.5 });
    device.pause();
    expect(device.status()).toMatchObject({ isRecording: false });
    device.resume();
    expect(device.status()).toMatchObject({ isRecording: true });
  });

  it("closes the file, releases the recorder and gives the session back, even when stop throws", async () => {
    const fake = fakeModules();
    const device = createRecorderDevice(fake.modules);
    await device.begin();
    fake.recorder.stop.mockRejectedValueOnce(new Error("already stopped"));
    await expect(device.finish()).rejects.toThrow();
    expect(fake.recorder.release).toHaveBeenCalled();
    expect(fake.audio.setAudioModeAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        allowsRecording: false,
        allowsBackgroundRecording: false,
      }),
    );
    expect(fake.audio.setIsAudioActiveAsync).toHaveBeenLastCalledWith(false);
    expect(device.status()).toBeNull();
  });

  it("reports an end nobody here asked for, and not its own stop", async () => {
    const fake = fakeModules();
    const device = createRecorderDevice(fake.modules);
    await device.begin();
    const ended = vi.fn();
    const off = device.onEnded(ended);
    fake.listeners[0]?.({ isFinished: false });
    expect(ended).not.toHaveBeenCalled();
    fake.listeners[0]?.({ isFinished: true });
    expect(ended).toHaveBeenCalledTimes(1);
    const listener = fake.listeners[0];
    await device.finish();
    listener?.({ isFinished: true });
    expect(ended).toHaveBeenCalledTimes(1);
    off();
    expect(fake.listeners).toHaveLength(0);
  });

  it("finds a file by its name after iOS moved the app's container", () => {
    const fake = fakeModules();
    const device = createRecorderDevice(fake.modules);
    fake.disk.set(`${DOCS}/ExpoAudio/recording-9.aac`, new Uint8Array(4));
    expect(
      device.locate("file:///old-container/ExpoAudio/recording-9.aac"),
    ).toBe(`${DOCS}/ExpoAudio/recording-9.aac`);
    expect(device.locate(`${DOCS}/ExpoAudio/recording-9.aac`)).toBe(
      `${DOCS}/ExpoAudio/recording-9.aac`,
    );
    expect(device.locate("file:///old-container/ExpoAudio/gone.aac")).toBeNull();
  });

  it("measures, reads a stretch of, and removes a file", () => {
    const fake = fakeModules();
    const device = createRecorderDevice(fake.modules);
    const uri = `${DOCS}/ExpoAudio/recording-1.aac`;
    expect(device.fileSize(uri)).toBeNull();
    fake.disk.set(uri, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(device.fileSize(uri)).toBe(8);
    const source = device.source(uri, 8);
    expect(source.size).toBe(8);
    expect(source.read(2, 5)).toEqual(Uint8Array.from([2, 3, 4]));
    device.remove(uri);
    expect(device.fileSize(uri)).toBeNull();
    // An empty file is no recording.
    fake.disk.set(uri, new Uint8Array());
    expect(device.fileSize(uri)).toBeNull();
  });

  it("clears every recording file but the ones kept", () => {
    const fake = fakeModules();
    const device = createRecorderDevice(fake.modules);
    fake.disk.set(`${DOCS}/ExpoAudio/recording-1.aac`, new Uint8Array(1));
    fake.disk.set(`${DOCS}/ExpoAudio/recording-2.aac`, new Uint8Array(1));
    fake.disk.set(`${DOCS}/Audio/recording-3.aac`, new Uint8Array(1));
    fake.disk.set(`${DOCS}/photos/keep.jpg`, new Uint8Array(1));
    device.purge([`${DOCS}/ExpoAudio/recording-2.aac`]);
    expect([...fake.disk.keys()].sort()).toEqual([
      `${DOCS}/ExpoAudio/recording-2.aac`,
      `${DOCS}/photos/keep.jpg`,
    ]);
  });

  it("says how much room the phone has, or nothing when it won't say", () => {
    const fake = fakeModules();
    const device = createRecorderDevice(fake.modules);
    expect(device.freeBytes()).toBe(5_000_000_000);
    fake.space.free = Number.NaN;
    expect(device.freeBytes()).toBeNull();
  });
});

describe("meetingRecorderDevice", () => {
  it("is absent in Expo Go and on web, without loading the audio module", () => {
    const load = vi.fn(() => fakeModules().modules);
    setRecorderModulesLoaderForTests(load);
    constantsState.executionEnvironment = "storeClient";
    expect(meetingRecorderDevice()).toBeNull();
    resetMeetingRecorderDeviceForTests();
    setRecorderModulesLoaderForTests(load);
    constantsState.executionEnvironment = "standalone";
    Platform.OS = "web";
    expect(meetingRecorderDevice()).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("is one device on a store build", () => {
    setRecorderModulesLoaderForTests(() => fakeModules().modules);
    const device = meetingRecorderDevice();
    expect(device).not.toBeNull();
    expect(meetingRecorderDevice()).toBe(device);
  });

  it("is absent on a build made before the audio module was added", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setRecorderModulesLoaderForTests(() => {
      throw new Error("Cannot find native module 'ExpoAudio'");
    });
    expect(meetingRecorderDevice()).toBeNull();
    warn.mockRestore();
  });
});

describe("the platform split", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (name: string) => readFileSync(join(here, name), "utf8");

  it("names the audio package only in the native half", () => {
    // A specifier anywhere else puts the package in the web bundle's graph.
    for (const name of [
      "native-module.ts",
      "device.ts",
      "controller.ts",
      "session.ts",
      "native-types.ts",
    ]) {
      expect(read(name), name).not.toMatch(/(require\(|from )["']expo-audio/);
    }
    expect(read("native-module.native.ts")).toContain('require("expo-audio")');
  });
});
