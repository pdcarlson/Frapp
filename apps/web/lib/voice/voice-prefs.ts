"use client";

/**
 * The voice prototype's audio settings (#3866; Shawn, 2026-11-12). See
 * `flag.ts`.
 *
 * Which microphone and speakers to use, the browser's voice processing, and
 * whether to join muted. Kept on this browser, like chat density: a laptop's
 * headset and a desktop's speakers are different devices, and a device id
 * means nothing on another machine. The call reads them when you join and
 * again whenever they change, so switching microphone mid-call works.
 */

import { useSyncExternalStore } from "react";

export type VoicePrefs = {
  /** `MediaDeviceInfo.deviceId`; null is the system default. */
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  /** Start every voice chat muted, as Zoom and Meet can. */
  joinMuted: boolean;
};

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  inputDeviceId: null,
  outputDeviceId: null,
  noiseSuppression: true,
  echoCancellation: true,
  joinMuted: false,
};

const KEY = "frapp-voice-prefs";
const EVENT = "frapp:voice-prefs";

let cached: VoicePrefs | null = null;

export function readVoicePrefs(): VoicePrefs {
  if (cached) return cached;
  let stored: Partial<VoicePrefs> = {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw) as Partial<VoicePrefs>;
  } catch {
    // Blocked storage, or a bad value: fall back to the defaults.
  }
  cached = { ...DEFAULT_VOICE_PREFS, ...stored };
  return cached;
}

export function writeVoicePrefs(patch: Partial<VoicePrefs>): void {
  cached = { ...readVoicePrefs(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Still applies for this session.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function useVoicePrefs(): VoicePrefs {
  return useSyncExternalStore(
    subscribe,
    readVoicePrefs,
    () => DEFAULT_VOICE_PREFS,
  );
}

/** The microphone request these settings make. */
export function audioConstraints(prefs: VoicePrefs): MediaTrackConstraints {
  return {
    ...(prefs.inputDeviceId ? { deviceId: { exact: prefs.inputDeviceId } } : {}),
    echoCancellation: prefs.echoCancellation,
    noiseSuppression: prefs.noiseSuppression,
    autoGainControl: true,
  };
}

/**
 * Whether this browser can send call audio to a chosen output. Chrome and Edge
 * can (`setSinkId`); where it can't, the picker says the system's output is
 * used instead of offering a choice that does nothing.
 */
export function canChooseOutput(): boolean {
  return (
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype
  );
}

type SinkElement = HTMLMediaElement & {
  setSinkId?: (id: string) => Promise<void>;
};

/** Route an audio element to the chosen output, where the browser allows. */
export function applyOutput(element: HTMLMediaElement, deviceId: string | null) {
  const sink = element as SinkElement;
  if (!sink.setSinkId) return;
  void sink.setSinkId(deviceId ?? "").catch(() => {
    // The device went away: the browser keeps the default.
  });
}
