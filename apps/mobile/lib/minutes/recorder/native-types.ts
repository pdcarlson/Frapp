/**
 * The parts of `expo-audio` and `expo-file-system` the meeting recorder
 * uses, declared structurally, so only the native half of the loader split
 * (`native-module.native.ts`) names the packages and the lint rule against
 * importing `expo-audio` has no exceptions.
 */

interface NativeRecorderStatus {
  isRecording: boolean;
  durationMillis: number;
  url: string | null;
}

export interface NativeRecorder {
  uri: string | null;
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  pause: () => void;
  stop: () => Promise<void>;
  getStatus: () => NativeRecorderStatus;
  addListener: (
    event: "recordingStatusUpdate",
    listener: (status: { isFinished: boolean }) => void,
  ) => { remove: () => void };
  release: () => void;
}

interface NativeAudio {
  AudioModule: {
    AudioRecorder: new (options: Record<string, unknown>) => NativeRecorder;
  };
  setAudioModeAsync: (mode: Record<string, unknown>) => Promise<void>;
  setIsAudioActiveAsync: (active: boolean) => Promise<void>;
  requestRecordingPermissionsAsync: () => Promise<{ granted: boolean }>;
  requestNotificationPermissionsAsync: () => Promise<{ granted: boolean }>;
}

interface NativeFileHandle {
  offset: number | null;
  readBytes: (length: number) => Uint8Array;
  close: () => void;
}

export interface NativeFile {
  uri: string;
  name: string;
  exists: boolean;
  size: number | null;
  delete: () => void;
  open: () => NativeFileHandle;
}

interface NativeDirectory {
  uri: string;
  exists: boolean;
  list: () => (NativeFile | NativeDirectory)[];
}

interface NativeFiles {
  File: new (...parts: (string | NativeDirectory)[]) => NativeFile;
  Directory: new (...parts: (string | NativeDirectory)[]) => NativeDirectory;
  Paths: { document: NativeDirectory; availableDiskSpace: number };
}

export interface RecorderNativeModules {
  audio: NativeAudio;
  files: NativeFiles;
}
