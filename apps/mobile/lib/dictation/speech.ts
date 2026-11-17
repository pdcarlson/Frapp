import { isWebOrExpoGo } from "../expo-go";
import { createIsolatedModule } from "../isolated-module";
import { requireSpeechModule } from "./speech-module";
import type {
  SpeechModule,
  SpeechResultEvent,
  SpeechStartOptions,
} from "./speech-types";

/**
 * The phone's own speech recogniser, for dictating into Ask Frapp (#5276;
 * Paul picked on-device speech on 2026-11-17 over sending audio to a
 * provider). Apple's `SFSpeechRecognizer` on iOS and Android's
 * `SpeechRecognizer`, through `expo-speech-recognition`.
 *
 * **On the phone where it can be.** A session asks for on-device recognition
 * whenever the recogniser says it supports it, so the voice never leaves the
 * phone. Where it doesn't (an older Android, or one whose language pack isn't
 * installed), the phone's own recogniser runs as the keyboard's mic does,
 * which is what the approved speech purpose string says: "On most phones this
 * happens on the phone itself."
 *
 * **Absent in Expo Go and on web.** Go doesn't ship the native module and the
 * web bundle must never name the package, so both get `null` here and Ask
 * draws no mic (`spec/ui/mobile/README.md` § Run paths).
 *
 * This file is the device boundary only: it starts and stops one listening
 * session and reports words, level and how it ended. What the field shows, and
 * the cleanup pass that tidies the words, belong to Ask's composer.
 */

const speech = createIsolatedModule<SpeechModule>({
  packageName: "expo-speech-recognition",
  whenUnavailable: "Ask draws no mic.",
  load: requireSpeechModule,
  isUnavailable: isWebOrExpoGo,
});

export const setSpeechLoaderForTests = speech.setLoaderForTests;

/** Ask's words, prompts and answers are English, so it listens for English. */
const DICTATION_LANG = "en-US";

/** How often the level reaches the waveform. */
const LEVEL_INTERVAL_MS = 60;

/** Whether this build and phone can dictate at all. Draw no mic when false. */
export function isDictationAvailable(): boolean {
  const module = speech.load();
  if (!module) return false;
  try {
    return module.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/**
 * Asks for the microphone and, on iOS, speech recognition, showing the
 * system's two dialogs the first time. True only when both are granted.
 */
export async function requestDictationPermission(): Promise<boolean> {
  const module = speech.load();
  if (!module) return false;
  try {
    const { granted } = await module.requestPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

/** How a session ended without words. */
export type DictationFailure =
  /** The member said no to the microphone or speech recognition. */
  | "denied"
  /** Nothing was heard. */
  | "no-speech"
  /** A call, Siri or an alarm took the audio. */
  | "interrupted"
  /** The recogniser can't run here now (busy, no language, no audio). */
  | "unavailable"
  | "failed";

export interface DictationHandlers {
  /** Everything heard so far, as the recogniser has it now. */
  onWords: (text: string) => void;
  /** The voice's level, 0 (silence) to 1 (loud), for the waveform. */
  onLevel: (level: number) => void;
  /** The session is over; `text` is everything heard (may be empty). */
  onEnd: (text: string) => void;
  onFailure: (failure: DictationFailure) => void;
}

export interface DictationSession {
  /** Stop listening and keep the words: `onEnd` follows. */
  finish: () => void;
  /** Stop listening and drop the words: no further callback. */
  cancel: () => void;
}

/**
 * Starts listening, or returns null when the module is absent. Call
 * `requestDictationPermission` first.
 *
 * Words arrive as the recogniser revises them. A final result fixes what it
 * covers: Android's continuous mode ends each pause with a final for that
 * stretch and starts afresh, so finals are kept in order and the partial in
 * progress is shown after them. iOS sends one final, at the end.
 */
export function startDictation(
  handlers: DictationHandlers,
  options: { contextualStrings?: string[] } = {},
): DictationSession | null {
  const loaded = speech.load();
  if (!loaded) return null;
  const module: SpeechModule = loaded;

  let onDevice = supportsOnDevice(module);
  // A fallback restart is allowed once, before any words: see `error`.
  let heardAnything = false;
  let committed = "";
  let partial = "";
  let done = false;

  const text = () => join(committed, partial);

  const subscriptions = [
    module.addListener("result", (event: SpeechResultEvent) => {
      if (done) return;
      const transcript = event.results[0]?.transcript ?? "";
      if (transcript) heardAnything = true;
      if (event.isFinal) {
        committed = join(committed, transcript);
        partial = "";
      } else {
        partial = transcript;
      }
      handlers.onWords(text());
    }),
    module.addListener("volumechange", ({ value }) => {
      if (done) return;
      handlers.onLevel(levelOf(value));
    }),
    module.addListener("error", ({ error }) => {
      if (done) return;
      // An Android phone that offers on-device recognition but lacks the
      // language pack refuses at start. Run its ordinary recogniser instead,
      // as the keyboard's mic would.
      if (error === "language-not-supported" && onDevice && !heardAnything) {
        onDevice = false;
        begin();
        return;
      }
      if (error === "aborted") return;
      end();
      handlers.onFailure(failureOf(error));
    }),
    module.addListener("end", () => {
      if (done) return;
      end();
      handlers.onEnd(text());
    }),
  ];

  function end() {
    done = true;
    for (const subscription of subscriptions) subscription.remove();
  }

  function begin() {
    const startOptions: SpeechStartOptions = {
      lang: DICTATION_LANG,
      interimResults: true,
      // A pause to think doesn't end the dictation; the member's check does.
      continuous: true,
      requiresOnDeviceRecognition: onDevice,
      addsPunctuation: true,
      iosTaskHint: "dictation",
      volumeChangeEventOptions: {
        enabled: true,
        intervalMillis: LEVEL_INTERVAL_MS,
      },
      ...(options.contextualStrings?.length
        ? { contextualStrings: options.contextualStrings }
        : {}),
    };
    try {
      module.start(startOptions);
    } catch {
      end();
      handlers.onFailure("unavailable");
    }
  }

  begin();

  return {
    finish() {
      if (done) return;
      try {
        module.stop();
      } catch {
        end();
        handlers.onEnd(text());
      }
    },
    cancel() {
      if (done) return;
      end();
      try {
        module.abort();
      } catch {
        // Already stopped: nothing to drop.
      }
    },
  };
}

function supportsOnDevice(module: SpeechModule): boolean {
  try {
    return module.supportsOnDeviceRecognition();
  } catch {
    return false;
  }
}

function join(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

/**
 * The recogniser reports -2 to 10, and anything at or below 0 is inaudible
 * (`volumechange` in the package's types).
 */
export function levelOf(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, 10) / 10;
}

function failureOf(error: string): DictationFailure {
  switch (error) {
    case "not-allowed":
      return "denied";
    case "no-speech":
    case "speech-timeout":
    case "nomatch":
      return "no-speech";
    case "interrupted":
      return "interrupted";
    case "service-not-allowed":
    case "language-not-supported":
    case "audio-capture":
    case "busy":
      return "unavailable";
    default:
      return "failed";
  }
}
