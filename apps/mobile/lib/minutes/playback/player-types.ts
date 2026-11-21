/**
 * The part of `expo-audio` the minutes' playback uses, declared
 * structurally for the same reason as `recorder/native-types.ts`: naming the
 * package in a type would put it back in the web bundle's graph.
 */
export interface NativePlayerStatus {
  playing: boolean;
  currentTime: number;
  duration: number;
  isLoaded: boolean;
  didJustFinish: boolean;
}

export interface NativePlayer {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  remove: () => void;
  addListener: (
    event: "playbackStatusUpdate",
    listener: (status: NativePlayerStatus) => void,
  ) => { remove: () => void };
}

export interface PlayerModule {
  createAudioPlayer: (source: { uri: string }) => NativePlayer;
  setAudioModeAsync: (mode: Record<string, unknown>) => Promise<void>;
}
