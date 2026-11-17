/**
 * The parts of `expo-speech-recognition` dictation uses, declared
 * structurally. A `typeof import("expo-speech-recognition")` in a type
 * position would put the package back in the web bundle's graph and defeat
 * the platform split (`spec/ui/mobile/README.md` § Run paths), so the surface
 * is written out here instead, as `lib/minutes/recorder/native-types.ts` does.
 */

export interface SpeechStartOptions {
  lang?: string;
  interimResults?: boolean;
  continuous?: boolean;
  requiresOnDeviceRecognition?: boolean;
  addsPunctuation?: boolean;
  contextualStrings?: string[];
  iosTaskHint?: "unspecified" | "dictation" | "search" | "confirmation";
  volumeChangeEventOptions?: { enabled?: boolean; intervalMillis?: number };
}

export interface SpeechResultEvent {
  isFinal: boolean;
  results: { transcript: string }[];
}

export interface SpeechErrorEvent {
  error: string;
  message: string;
}

export interface SpeechEventMap {
  result: SpeechResultEvent;
  error: SpeechErrorEvent;
  end: null;
  volumechange: { value: number };
}

export interface SpeechModule {
  start: (options: SpeechStartOptions) => void;
  stop: () => void;
  abort: () => void;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  isRecognitionAvailable: () => boolean;
  supportsOnDeviceRecognition: () => boolean;
  addListener: <K extends keyof SpeechEventMap>(
    event: K,
    listener: (event: SpeechEventMap[K]) => void,
  ) => { remove: () => void };
}
