import type { SpeechModule } from "./speech-types";

/** iOS/Android half of the loader split: see `speech-module.ts`. */
export function requireSpeechModule(): SpeechModule | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const speech = require("expo-speech-recognition") as {
    ExpoSpeechRecognitionModule: SpeechModule;
  };
  return speech.ExpoSpeechRecognitionModule;
}
