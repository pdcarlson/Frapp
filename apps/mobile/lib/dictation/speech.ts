import { Platform } from "react-native";
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
 * **On the phone where it can be.** A session demands on-device recognition
 * wherever the package can enforce it: on iOS when the recogniser reports
 * support, and on Android 13 and later, where the package builds Android's
 * on-device recogniser. Android 12 reports support too, but the package only
 * asks Google's service there to prefer offline, which does not keep the voice
 * on the phone, so it isn't counted. Elsewhere, and on an Android phone whose
 * on-device recogniser lacks the English pack, the phone's ordinary recogniser
 * runs, as the keyboard's mic does, and Apple or Google turns the speech into
 * text. The approved speech purpose string says as much: "On most phones this
 * happens on the phone itself."
 *
 * **Absent in Expo Go and on web.** Go doesn't ship the native module, which
 * the package reads at import. On web the package would run the browser's
 * recogniser (Chrome's sends audio to Google), and Ask has no web mic in #5276.
 * So both get `null` here, and Ask draws its mic only where this loads
 * (`spec/ui/mobile/README.md` § Run paths).
 *
 * **Known gap:** on iOS the package checks availability and on-device support
 * for the phone's own language, while sessions listen in US English. A phone
 * set to a language Apple's recogniser doesn't cover may report no dictation
 * though English would work.
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

/** Android 13: the first release the package builds an on-device recogniser for. */
const ANDROID_ON_DEVICE_API = 33;

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

/** How a session ended before any words were heard. */
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
  /**
   * The session is over with everything heard. Also how a session that heard
   * words ends when the recogniser then fails (a call, a dropped network):
   * the words are kept.
   */
  onEnd: (text: string) => void;
  /** The session is over and nothing was heard. */
  onFailure: (failure: DictationFailure) => void;
}

export interface DictationSession {
  /** Stop listening and keep the words: `onEnd` follows. */
  finish: () => void;
  /** Stop listening and drop the words: no further callback. */
  cancel: () => void;
}

/** The session listening now. The recogniser is one per app. */
let current: DictationSession | null = null;

/**
 * Starts listening, or returns null when the module is absent or refused to
 * start (`onFailure` has then been called). Call
 * `requestDictationPermission` first. A session already listening is
 * cancelled first: the native recogniser is one per app, and on Android a new
 * start replaces the old one without telling it.
 *
 * Words arrive as the recogniser revises them. A final result fixes what it
 * covers: Android's continuous mode ends each pause with a final for that
 * stretch and starts afresh, so finals are kept in order and the partial in
 * progress is shown after them. iOS sends one final, at the end.
 *
 * Both platforms send `end` after every `error`, so a session ends on `end`,
 * never on the error itself, and a restart waits for that `end`.
 */
export function startDictation(
  handlers: DictationHandlers,
  options: { contextualStrings?: string[] } = {},
): DictationSession | null {
  const loaded = speech.load();
  if (!loaded) return null;
  const module: SpeechModule = loaded;

  current?.cancel();

  let onDevice = supportsOnDevice(module);
  let committed = "";
  let partial = "";
  let done = false;
  /** The error this run ended with, reported when its `end` arrives. */
  let failure: DictationFailure | null = null;
  /** Start again without on-device once this run's `end` arrives. */
  let restart = false;

  const text = () => join(committed, partial);

  const subscriptions = [
    module.addListener("result", (event: SpeechResultEvent) => {
      if (done) return;
      const transcript = event.results[0]?.transcript ?? "";
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
      // An Android phone that has an on-device recogniser but not its English
      // pack refuses at start. Once this run has ended, run the phone's
      // ordinary recogniser instead, as the keyboard's mic would.
      if (error === "language-not-supported" && onDevice && !text()) {
        onDevice = false;
        restart = true;
        return;
      }
      failure = failureOf(error);
    }),
    module.addListener("end", () => {
      if (done) return;
      if (restart) {
        restart = false;
        begin();
        return;
      }
      finishWith(failure);
    }),
  ];

  const session: DictationSession = {
    finish() {
      if (done) return;
      try {
        module.stop();
      } catch {
        finishWith(null);
      }
    },
    cancel() {
      if (done) return;
      close();
      try {
        module.abort();
      } catch {
        // Already stopped: nothing to drop.
      }
    },
  };
  current = session;

  function close() {
    done = true;
    for (const subscription of subscriptions) subscription.remove();
    if (current === session) current = null;
  }

  /** Words heard are always kept, whatever stopped the recogniser. */
  function finishWith(why: DictationFailure | null) {
    close();
    const heard = text();
    if (heard || !why) handlers.onEnd(heard);
    else handlers.onFailure(why);
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
      finishWith("unavailable");
    }
  }

  begin();
  return done ? null : session;
}

/**
 * Whether a session can demand on-device recognition and get it. Android 12
 * answers yes, but the package builds the on-device recogniser only from
 * Android 13 (see the header).
 */
function supportsOnDevice(module: SpeechModule): boolean {
  if (Platform.OS === "android" && Number(Platform.Version) < ANDROID_ON_DEVICE_API) {
    return false;
  }
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
