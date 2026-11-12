import { Platform } from "react-native";
import { MEETING_RECORDER_FORMAT } from "@repo/validation";
import { isWebOrExpoGo } from "@/lib/expo-go";
import { createIsolatedModule } from "@/lib/isolated-module";
import type { RecorderDevice } from "./controller";
import { requireRecorderModules } from "./native-module";
import type {
  NativeFile,
  NativeRecorder,
  RecorderNativeModules,
} from "./native-types";

/**
 * The phone's microphone, recorder and disk, as the controller uses them
 * (`RecorderDevice`), over `expo-audio` and `expo-file-system`.
 *
 * `expo-audio` is the app's first audio module, added for this
 * (`spec/behavior/meetings.md` § Recording in the app), so it sits behind an
 * isolation module like every package Expo Go can't run in full: Go has no
 * background-recording service, and a build made before the module landed
 * has no module at all. Where it is missing `meetingRecorderDevice()` is
 * null and the minutes screen offers no Record.
 *
 * What this file decides, because nothing above it can:
 * - **The file is ADTS AAC, one channel** (`MEETING_RECORDER_FORMAT`), in the
 *   app's documents, which the system never clears. The reason for ADTS is
 *   beside the format.
 * - **Recording continues with the screen locked.** `allowsBackgroundRecording`
 *   is iOS's `audio` background mode and Android's microphone foreground
 *   service; both are declared by the `expo-audio` plugin in `app.json`.
 *   Other audio stops (`doNotMix`), so music isn't recorded over a meeting.
 * - **A call pauses the recorder** on iOS, and the module resumes it only
 *   when iOS says to. The controller reads `isRecording` every second and
 *   shows the pause, so the officer is never left thinking it is recording.
 *   Android hands a call's audio to nobody and keeps writing silence.
 */
const recorderModules = createIsolatedModule<RecorderNativeModules>({
  packageName: "expo-audio",
  whenUnavailable: "recording a meeting is not offered on this build.",
  load: requireRecorderModules,
  isUnavailable: isWebOrExpoGo,
});

export const setRecorderModulesLoaderForTests = recorderModules.setLoaderForTests;

/** Where each platform's recorder writes under the app's documents. */
const RECORDING_FOLDERS = ["ExpoAudio", "Audio"];

/** `aac ` is Core Audio's four-character code for MPEG-4 AAC. */
const IOS_FORMAT_AAC = "aac ";
/** `AVAudioQuality.high`. */
const IOS_QUALITY_HIGH = 0x60;

const RECORDING_OPTIONS = {
  extension: `.${MEETING_RECORDER_FORMAT.extension}`,
  sampleRate: MEETING_RECORDER_FORMAT.sampleRate,
  numberOfChannels: MEETING_RECORDER_FORMAT.channels,
  bitRate: MEETING_RECORDER_FORMAT.bitRate,
  isMeteringEnabled: false,
  directory: "document",
  ...(Platform.OS === "ios"
    ? { outputFormat: IOS_FORMAT_AAC, audioQuality: IOS_QUALITY_HIGH }
    : { outputFormat: "aac_adts", audioEncoder: "aac" }),
};

const RECORDING_MODE = {
  allowsRecording: true,
  playsInSilentMode: true,
  allowsBackgroundRecording: true,
  interruptionMode: "doNotMix",
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
};

/** The session as it is when nothing is recording: the microphone released. */
const RESTING_MODE = {
  allowsRecording: false,
  playsInSilentMode: false,
  allowsBackgroundRecording: false,
  interruptionMode: "mixWithOthers",
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
};

const nameOf = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

export function createRecorderDevice({
  audio,
  files,
}: RecorderNativeModules): RecorderDevice {
  let recorder: NativeRecorder | null = null;
  let finishing = false;

  const fileAt = (uri: string): NativeFile | null => {
    try {
      const file = new files.File(uri);
      return file.exists ? file : null;
    } catch {
      return null;
    }
  };

  const release = () => {
    try {
      recorder?.release();
    } catch {
      // Already released.
    }
    recorder = null;
  };

  return {
    async microphone() {
      const answer = await audio.requestRecordingPermissionsAsync();
      return answer.granted ? "granted" : "denied";
    },

    async backgroundAllowed() {
      if (Platform.OS !== "android") return true;
      const answer = await audio.requestNotificationPermissionsAsync();
      return answer.granted;
    },

    freeBytes() {
      try {
        const free = files.Paths.availableDiskSpace;
        return Number.isFinite(free) && free >= 0 ? free : null;
      } catch {
        return null;
      }
    },

    async begin() {
      release();
      finishing = false;
      await audio.setAudioModeAsync(RECORDING_MODE);
      await audio.setIsAudioActiveAsync(true).catch(() => undefined);
      const next = new audio.AudioModule.AudioRecorder(RECORDING_OPTIONS);
      recorder = next;
      // No options here: preparing with options makes iOS open a second file.
      await next.prepareToRecordAsync();
      next.record();
      const uri = next.uri ?? next.getStatus().url;
      if (!uri) throw new Error("The recorder gave no file.");
      return { uri };
    },

    pause() {
      recorder?.pause();
    },

    resume() {
      recorder?.record();
    },

    status() {
      if (!recorder) return null;
      try {
        const status = recorder.getStatus();
        return {
          isRecording: status.isRecording,
          seconds: status.durationMillis / 1000,
        };
      } catch {
        return null;
      }
    },

    async finish() {
      finishing = true;
      try {
        await recorder?.stop();
      } finally {
        release();
        await audio.setAudioModeAsync(RESTING_MODE).catch(() => undefined);
        // Hands the speaker back, so music the recording paused can resume.
        await audio.setIsAudioActiveAsync(false).catch(() => undefined);
      }
    },

    onEnded(listener) {
      const subscription = recorder?.addListener(
        "recordingStatusUpdate",
        (status) => {
          // Our own `finish` ends it too; only an end nobody here asked for
          // is news.
          if (status.isFinished && !finishing) listener();
        },
      );
      return () => subscription?.remove();
    },

    locate(uri) {
      if (fileAt(uri)) return uri;
      // iOS moves the app's container when the app updates, so a path
      // written down before an update is looked for by its name.
      for (const folder of RECORDING_FOLDERS) {
        try {
          const moved = new files.File(files.Paths.document, folder, nameOf(uri));
          if (moved.exists) return moved.uri;
        } catch {
          // Not there.
        }
      }
      return null;
    },

    fileSize(uri) {
      const size = fileAt(uri)?.size;
      return typeof size === "number" && size > 0 ? size : null;
    },

    remove(uri) {
      try {
        fileAt(uri)?.delete();
      } catch {
        // `purge` takes what this leaves behind, on the next launch.
      }
    },

    source(uri, size) {
      return {
        size,
        read(from, to) {
          const handle = new files.File(uri).open();
          try {
            handle.offset = from;
            return handle.readBytes(to - from) as unknown as BodyInit;
          } finally {
            handle.close();
          }
        },
      };
    },

    purge(keepUri) {
      const keep = keepUri ? nameOf(keepUri) : null;
      for (const folder of RECORDING_FOLDERS) {
        try {
          const directory = new files.Directory(files.Paths.document, folder);
          if (!directory.exists) continue;
          for (const entry of directory.list()) {
            if ("delete" in entry && nameOf(entry.uri) !== keep) entry.delete();
          }
        } catch {
          // Nothing to clear, or not ours to list.
        }
      }
    },
  };
}

let device: RecorderDevice | null | undefined;

/** The phone's recorder, or null on a build that can't record. */
export function meetingRecorderDevice(): RecorderDevice | null {
  if (device !== undefined) return device;
  const modules = recorderModules.load();
  device = modules ? createRecorderDevice(modules) : null;
  return device;
}

/** Test-only: forget the device built from an earlier loader. */
export function resetMeetingRecorderDeviceForTests(): void {
  device = undefined;
}
