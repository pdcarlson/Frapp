import { useCallback, useEffect, useRef, useState } from "react";
import { requirePlayerModule } from "./player-module";
import type { NativePlayer, PlayerModule } from "./player-types";

export interface Playback {
  /** False where this build can't play audio, or there is nothing to play. */
  available: boolean;
  playing: boolean;
  /** Seconds in, and the whole length once known (else null). */
  position: number;
  duration: number | null;
  /** The link stopped working (it lasts an hour) or the file is gone. */
  failed: boolean;
  toggle: () => void;
}

let loaded: PlayerModule | null | undefined;
function playerModule(): PlayerModule | null {
  if (loaded === undefined) {
    try {
      loaded = requirePlayerModule();
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

/**
 * Plays a meeting's recording back from its signed link (Paul, 2026-11-17:
 * "Keep audio until minutes are posted"). Nothing loads until the first
 * press, so opening the minutes never downloads an hour of audio. A new
 * link (the server signs one per read) is kept off the player while it
 * plays, so a refetch doesn't restart it.
 */
export function usePlayback(url: string | null): Playback {
  const module = playerModule();
  const player = useRef<NativePlayer | null>(null);
  const loadedUrl = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const release = useCallback(() => {
    player.current?.remove();
    player.current = null;
    loadedUrl.current = null;
  }, []);
  useEffect(() => release, [release]);
  // No link any more (the minutes were posted, or the recording removed).
  useEffect(() => {
    if (!url) {
      release();
      setPlaying(false);
    }
  }, [url, release]);

  const toggle = useCallback(() => {
    if (!module || !url) return;
    if (player.current && playing) {
      player.current.pause();
      return;
    }
    if (!player.current) {
      try {
        void module
          .setAudioModeAsync({ playsInSilentMode: true })
          .catch(() => undefined);
        const created = module.createAudioPlayer({ uri: url });
        created.addListener("playbackStatusUpdate", (status) => {
          setPlaying(status.playing);
          setPosition(status.currentTime);
          if (status.isLoaded && status.duration > 0) {
            setDuration(status.duration);
          }
          if (status.didJustFinish) void created.seekTo(0);
        });
        player.current = created;
        loadedUrl.current = url;
        setFailed(false);
      } catch {
        setFailed(true);
        return;
      }
    }
    player.current.play();
  }, [module, url, playing]);

  return {
    available: !!module && !!url,
    playing,
    position,
    duration,
    failed,
    toggle,
  };
}
