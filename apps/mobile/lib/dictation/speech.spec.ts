import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const constantsState = vi.hoisted(() => ({
  executionEnvironment: "standalone",
}));

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
  isDictationAvailable,
  levelOf,
  requestDictationPermission,
  setSpeechLoaderForTests,
  startDictation,
  type DictationHandlers,
} from "./speech";
import type {
  SpeechEventMap,
  SpeechModule,
  SpeechStartOptions,
} from "./speech-types";

type Listeners = {
  [K in keyof SpeechEventMap]: Set<(event: SpeechEventMap[K]) => void>;
};

function fakeSpeech(overrides: Partial<SpeechModule> = {}) {
  const listeners: Listeners = {
    result: new Set(),
    error: new Set(),
    end: new Set(),
    volumechange: new Set(),
  };
  const starts: SpeechStartOptions[] = [];
  const module: SpeechModule = {
    start: vi.fn((options: SpeechStartOptions) => {
      starts.push(options);
    }),
    stop: vi.fn(() => emit("end", null)),
    abort: vi.fn(),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
    isRecognitionAvailable: vi.fn(() => true),
    supportsOnDeviceRecognition: vi.fn(() => true),
    addListener: ((event, listener) => {
      const set = listeners[event] as Set<typeof listener>;
      set.add(listener);
      return { remove: () => set.delete(listener) };
    }) as SpeechModule["addListener"],
    ...overrides,
  };
  function emit<K extends keyof SpeechEventMap>(
    event: K,
    payload: SpeechEventMap[K],
  ) {
    for (const listener of [...listeners[event]]) {
      (listener as (e: SpeechEventMap[K]) => void)(payload);
    }
  }
  const listenerCount = () =>
    Object.values(listeners).reduce((n, set) => n + set.size, 0);
  return { module, emit, starts, listenerCount };
}

function handlers() {
  return {
    onWords: vi.fn<DictationHandlers["onWords"]>(),
    onLevel: vi.fn<DictationHandlers["onLevel"]>(),
    onEnd: vi.fn<DictationHandlers["onEnd"]>(),
    onFailure: vi.fn<DictationHandlers["onFailure"]>(),
  };
}

function result(transcript: string, isFinal = false) {
  return { isFinal, results: [{ transcript }] };
}

beforeEach(() => {
  constantsState.executionEnvironment = "standalone";
});

afterEach(() => {
  setSpeechLoaderForTests(null);
});

describe("availability", () => {
  it("is off where the module is absent (web's half of the split)", () => {
    expect(isDictationAvailable()).toBe(false);
  });

  it("never loads the module in Expo Go", () => {
    constantsState.executionEnvironment = "storeClient";
    const load = vi.fn(() => fakeSpeech().module);
    setSpeechLoaderForTests(load);
    expect(isDictationAvailable()).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("follows the recogniser's own answer", () => {
    const { module } = fakeSpeech({
      isRecognitionAvailable: vi.fn(() => false),
    });
    setSpeechLoaderForTests(() => module);
    expect(isDictationAvailable()).toBe(false);
  });

  it("is on in a store build whose recogniser runs", () => {
    setSpeechLoaderForTests(() => fakeSpeech().module);
    expect(isDictationAvailable()).toBe(true);
  });
});

describe("requestDictationPermission", () => {
  it("is false without the module and when either permission is refused", async () => {
    expect(await requestDictationPermission()).toBe(false);
    setSpeechLoaderForTests(
      () =>
        fakeSpeech({
          requestPermissionsAsync: vi.fn(async () => ({ granted: false })),
        }).module,
    );
    expect(await requestDictationPermission()).toBe(false);
  });

  it("is true when both are granted", async () => {
    setSpeechLoaderForTests(() => fakeSpeech().module);
    expect(await requestDictationPermission()).toBe(true);
  });
});

describe("startDictation", () => {
  it("returns null without the module", () => {
    expect(startDictation(handlers())).toBeNull();
  });

  it("listens on the phone, continuously, with live words, punctuation and level", () => {
    const fake = fakeSpeech();
    setSpeechLoaderForTests(() => fake.module);
    startDictation(handlers(), { contextualStrings: ["rush-chairs"] });
    expect(fake.starts).toEqual([
      expect.objectContaining({
        lang: "en-US",
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        iosTaskHint: "dictation",
        contextualStrings: ["rush-chairs"],
        volumeChangeEventOptions: expect.objectContaining({ enabled: true }),
      }),
    ]);
  });

  it("does not demand on-device recognition where the phone has none", () => {
    const fake = fakeSpeech({
      supportsOnDeviceRecognition: vi.fn(() => false),
    });
    setSpeechLoaderForTests(() => fake.module);
    startDictation(handlers());
    expect(fake.starts[0]?.requiresOnDeviceRecognition).toBe(false);
  });

  it("shows finals in order with the partial in progress after them, and ends with all of it", () => {
    const fake = fakeSpeech();
    setSpeechLoaderForTests(() => fake.module);
    const h = handlers();
    const session = startDictation(h)!;

    fake.emit("result", result("so um can you"));
    fake.emit("result", result("so um can you remind the rush chairs", true));
    fake.emit("result", result("that the bid dinner"));
    expect(h.onWords).toHaveBeenLastCalledWith(
      "so um can you remind the rush chairs that the bid dinner",
    );

    fake.emit("result", result("that the bid dinner moved to Friday", true));
    session.finish();
    expect(fake.module.stop).toHaveBeenCalled();
    expect(h.onEnd).toHaveBeenCalledWith(
      "so um can you remind the rush chairs that the bid dinner moved to Friday",
    );
    expect(h.onFailure).not.toHaveBeenCalled();
    expect(fake.listenerCount()).toBe(0);
  });

  it("reports the voice's level from 0 to 1", () => {
    const fake = fakeSpeech();
    setSpeechLoaderForTests(() => fake.module);
    const h = handlers();
    startDictation(h);
    fake.emit("volumechange", { value: 5 });
    expect(h.onLevel).toHaveBeenLastCalledWith(0.5);
    expect(levelOf(-2)).toBe(0);
    expect(levelOf(0)).toBe(0);
    expect(levelOf(12)).toBe(1);
    expect(levelOf(Number.NaN)).toBe(0);
  });

  it("drops the words on cancel and calls back nothing more", () => {
    const fake = fakeSpeech();
    setSpeechLoaderForTests(() => fake.module);
    const h = handlers();
    const session = startDictation(h)!;
    fake.emit("result", result("never mind"));
    session.cancel();
    expect(fake.module.abort).toHaveBeenCalled();
    fake.emit("error", { error: "aborted", message: "" });
    fake.emit("end", null);
    expect(h.onEnd).not.toHaveBeenCalled();
    expect(h.onFailure).not.toHaveBeenCalled();
    expect(fake.listenerCount()).toBe(0);
  });

  it.each([
    ["not-allowed", "denied"],
    ["no-speech", "no-speech"],
    ["speech-timeout", "no-speech"],
    ["interrupted", "interrupted"],
    ["busy", "unavailable"],
    ["network", "failed"],
  ])("reports %s as %s, once", (error, failure) => {
    const fake = fakeSpeech();
    setSpeechLoaderForTests(() => fake.module);
    const h = handlers();
    startDictation(h);
    fake.emit("error", { error, message: "" });
    fake.emit("end", null);
    expect(h.onFailure).toHaveBeenCalledTimes(1);
    expect(h.onFailure).toHaveBeenCalledWith(failure);
    expect(h.onEnd).not.toHaveBeenCalled();
  });

  it("falls back to the phone's ordinary recogniser once when on-device has no language pack", () => {
    const fake = fakeSpeech();
    setSpeechLoaderForTests(() => fake.module);
    const h = handlers();
    startDictation(h);
    fake.emit("error", { error: "language-not-supported", message: "" });
    expect(fake.starts.map((s) => s.requiresOnDeviceRecognition)).toEqual([
      true,
      false,
    ]);
    expect(h.onFailure).not.toHaveBeenCalled();

    fake.emit("error", { error: "language-not-supported", message: "" });
    expect(fake.starts).toHaveLength(2);
    expect(h.onFailure).toHaveBeenCalledWith("unavailable");
  });

  it("reports a start that throws as unavailable", () => {
    const fake = fakeSpeech({
      start: vi.fn(() => {
        throw new Error("no audio session");
      }),
    });
    setSpeechLoaderForTests(() => fake.module);
    const h = handlers();
    startDictation(h);
    expect(h.onFailure).toHaveBeenCalledWith("unavailable");
    expect(fake.listenerCount()).toBe(0);
  });
});

describe("the platform split", () => {
  it("keeps the package's name out of the web half", () => {
    const web = readFileSync(
      path.join(__dirname, "speech-module.ts"),
      "utf8",
    );
    expect(web).not.toMatch(/require\(|from "expo-speech-recognition"/);
  });
});
