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

/** How long a press waits for the audio to load before saying it failed. */
export const PLAYBACK_LOAD_TIMEOUT_MS = 15_000;

/**
 * Plays a meeting's recording back from its signed link (Paul, 2026-11-17:
 * "Keep audio until minutes are posted"). Nothing loads until the first
 * press, so opening the minutes never downloads an hour of audio. A new
 * link (the server signs one per read, each lasting an hour) is kept off
 * the player while it plays, so a refetch doesn't restart it, and taken up
 * at the next press after a pause, from where it was, so a link that has
 * run out is never the one asked to play. Audio that hasn't loaded within
 * `PLAYBACK_LOAD_TIMEOUT_MS` of a press reads as failed.
 */
export function usePlayback(url: string | null): Playback {
  const module = playerModule();
  const player = useRef<NativePlayer | null>(null);
  const loadedUrl = useRef<string | null>(null);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const clearLoadTimer = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = null;
  }, []);
  const release = useCallback(() => {
    clearLoadTimer();
    player.current?.remove();
    player.current = null;
    loadedUrl.current = null;
  }, [clearLoadTimer]);
  useEffect(() => release, [release]);
  // No link any more (the minutes were posted, or the recording removed).
  useEffect(() => {
    if (!url) release();
  }, [url, release]);

  const toggle = useCallback(() => {
    if (!module || !url) return;
    if (player.current && playing) {
      player.current.pause();
      return;
    }
    // Paused on a link the server has since replaced: start again on the
    // fresh one, from the same place.
    let resumeAt = 0;
    if (player.current && loadedUrl.current !== url) {
      resumeAt = position;
      release();
    }
    if (!player.current) {
      try {
        void module
          .setAudioModeAsync({ playsInSilentMode: true })
          .catch(() => undefined);
        const created = module.createAudioPlayer({ uri: url });
        created.addListener("playbackStatusUpdate", (status) => {
          if (status.isLoaded) clearLoadTimer();
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
        if (resumeAt > 0) void created.seekTo(resumeAt).catch(() => undefined);
        clearLoadTimer();
        loadTimer.current = setTimeout(() => {
          loadTimer.current = null;
          if (player.current !== created) return;
          setFailed(true);
          release();
        }, PLAYBACK_LOAD_TIMEOUT_MS);
      } catch {
        setFailed(true);
        return;
      }
    }
    player.current.play();
  }, [module, url, playing, position, release, clearLoadTimer]);

  return {
    available: !!module && !!url,
    playing: playing && !!url,
    position,
    duration,
    failed,
    toggle,
  };
}
