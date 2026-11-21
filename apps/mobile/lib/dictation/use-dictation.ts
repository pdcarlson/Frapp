import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { selectionHaptic } from "../haptics";
import {
  isDictationAvailable,
  requestDictationPermission,
  startDictation,
  type DictationFailure,
  type DictationSession,
} from "./speech";

/**
 * Dictation into Ask's field (#5276) and the phone's chat composers (#5772,
 * through `components/dictation/use-field-dictation.ts`), as Paul picked it on 2026-11-17 from
 * the design page: tap the mic, talk while a waveform follows the voice, tap
 * the check, and the words land in the field tidied up (no fillers or false
 * starts, with punctuation). Nothing is sent by speaking: the member reads,
 * edits and taps send.
 *
 * Phases: `idle`, `listening` (the recogniser is on, words and level arrive)
 * and `cleaning` (the words are with Frapp's AI for about a second). The
 * cleanup is the caller's `clean`, which resolves the tidied text or `null`;
 * `null`, a timeout or no Frapp AI all leave the words as heard.
 *
 * **The fast values live outside React state.** The level arrives every
 * 60 ms, so it, the words and the clock are kept in {@link DictationLive}, a
 * small store that only the waveform and the words line subscribe to
 * ({@link useDictationLive}). Held as the host's state they re-rendered the
 * whole Ask sheet, thread and all, sixteen times a second.
 *
 * **It fits the field.** The caller says how many characters the field has
 * left (`room`). Listening stops by itself once the words fill it, and words
 * past it are cut at a word boundary with the `full` notice, so nothing is
 * dropped without the member being told.
 */

export type DictationPhase = "idle" | "listening" | "cleaning";

/** Why the last try ended short: a failure, or the field filled up. */
export type DictationNotice = DictationFailure | "full";

/** How many level samples the waveform draws, newest last. */
export const DICTATION_LEVEL_SAMPLES = 28;

/**
 * Dictation stops itself after this long, as if the check were tapped. A
 * question is a sentence or three; this keeps a mic forgotten open from
 * running on.
 */
export const DICTATION_MAX_SECONDS = 120;

export interface DictationLiveState {
  /** Everything heard so far, while listening and while it is tidied. */
  words: string;
  /** The voice's recent levels, 0 to 1, oldest first. */
  levels: number[];
  /** Whole seconds since listening began. */
  seconds: number;
}

const EMPTY: DictationLiveState = { words: "", levels: [], seconds: 0 };

/** The fast-changing values, for the pieces that draw them. */
export interface DictationLive {
  get: () => DictationLiveState;
  subscribe: (listener: () => void) => () => void;
}

function createLive() {
  let state = EMPTY;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: Partial<DictationLiveState>) => {
      state = { ...state, ...next };
      notify();
    },
    reset: () => {
      if (state === EMPTY) return;
      state = EMPTY;
      notify();
    },
  };
}

/** Subscribes a drawing piece to the live values. */
export function useDictationLive(live: DictationLive): DictationLiveState {
  return useSyncExternalStore(live.subscribe, live.get, live.get);
}

export interface UseDictationOptions {
  /** The cleanup pass: tidied text, or `null` to keep the words as heard. */
  clean: (text: string, options: { signal: AbortSignal }) => Promise<string | null>;
  /** The words are ready for the field: `text` tidied, `heard` as spoken. */
  onText: (text: string, heard: string) => void;
  /** Characters the field has left for these words. */
  room: number;
}

export interface Dictation {
  /** False in Expo Go, on web, and where the phone has no recogniser: draw no mic. */
  available: boolean;
  phase: DictationPhase;
  live: DictationLive;
  /** Why the last try ended short, until the next try, a send or `dismiss`. */
  notice: DictationNotice | null;
  start: () => void;
  /** Stop listening and keep the words. */
  finish: () => void;
  /** Stop and drop everything, the notice included. */
  cancel: () => void;
  dismiss: () => void;
}

export function useDictation({
  clean,
  onText,
  room,
}: UseDictationOptions): Dictation {
  const available = useMemo(() => isDictationAvailable(), []);
  const live = useMemo(() => createLive(), []);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [notice, setNotice] = useState<DictationNotice | null>(null);

  const phaseRef = useRef<DictationPhase>("idle");
  const session = useRef<DictationSession | null>(null);
  const cleaning = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Bumped by every start and cancel, so a callback from an older try is
  // dropped rather than landing in the field after the member moved on.
  const attempt = useRef(0);
  const latest = useRef({ clean, onText, room });
  useEffect(() => {
    latest.current = { clean, onText, room };
  }, [clean, onText, room]);

  const enter = useCallback((next: DictationPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const reset = useCallback(() => {
    stopTimer();
    session.current = null;
    live.reset();
  }, [live, stopTimer]);

  const finish = useCallback(() => {
    if (phaseRef.current !== "listening") return;
    selectionHaptic();
    session.current?.finish();
  }, []);

  const cancel = useCallback(() => {
    attempt.current += 1;
    session.current?.cancel();
    cleaning.current?.abort();
    cleaning.current = null;
    reset();
    enter("idle");
    setNotice(null);
  }, [enter, reset]);

  const start = useCallback(() => {
    if (!available || phaseRef.current !== "idle") return;
    const mine = ++attempt.current;
    setNotice(null);
    void (async () => {
      const granted = await requestDictationPermission();
      if (mine !== attempt.current) return;
      if (!granted) {
        setNotice("denied");
        return;
      }
      selectionHaptic();
      reset();
      enter("listening");
      const begun = startDictation({
        onWords: (heard) => {
          if (mine !== attempt.current) return;
          live.set({ words: heard });
          // The field is full: stop as if the check were tapped.
          if (heard.trim().length >= latest.current.room) {
            session.current?.finish();
          }
        },
        onLevel: (level) => {
          if (mine !== attempt.current) return;
          live.set({
            levels: [...live.get().levels, level].slice(
              -DICTATION_LEVEL_SAMPLES,
            ),
          });
        },
        onEnd: (all) => {
          if (mine !== attempt.current) return;
          stopTimer();
          session.current = null;
          const { text: heard, clipped } = fit(all, latest.current.room);
          if (!heard) {
            reset();
            enter("idle");
            setNotice(clipped ? "full" : "no-speech");
            return;
          }
          live.set({ words: heard });
          enter("cleaning");
          const controller = new AbortController();
          cleaning.current = controller;
          void latest.current
            .clean(heard, { signal: controller.signal })
            .catch(() => null)
            .then((tidied) => {
              if (mine !== attempt.current) return;
              cleaning.current = null;
              const tidy = tidied?.trim() ?? "";
              // Tidied words that no longer fit keep the words as heard,
              // which do.
              const text =
                tidy && tidy.length <= latest.current.room ? tidy : heard;
              reset();
              enter("idle");
              if (clipped) setNotice("full");
              latest.current.onText(text, heard);
            });
        },
        onFailure: (why) => {
          if (mine !== attempt.current) return;
          reset();
          enter("idle");
          setNotice(why);
        },
      });
      if (mine !== attempt.current) return;
      if (!begun) {
        // `onFailure` has already said why, unless the module vanished.
        if (phaseRef.current === "listening") {
          reset();
          enter("idle");
          setNotice("unavailable");
        }
        return;
      }
      session.current = begun;
      let elapsed = 0;
      timer.current = setInterval(() => {
        elapsed += 1;
        live.set({ seconds: elapsed });
        if (elapsed >= DICTATION_MAX_SECONDS) session.current?.finish();
      }, 1000);
    })();
  }, [available, enter, live, reset, stopTimer]);

  const dismiss = useCallback(() => setNotice(null), []);

  // Leaving the sheet drops whatever was in progress.
  useEffect(() => cancel, [cancel]);

  return {
    available,
    phase,
    live,
    notice,
    start,
    finish,
    cancel,
    dismiss,
  };
}

/**
 * The words trimmed to the room left, cut at the last word boundary that
 * fits, and whether anything was cut.
 */
export function fit(
  words: string,
  room: number,
): { text: string; clipped: boolean } {
  const text = words.trim();
  if (text.length <= room) return { text, clipped: false };
  const cut = text.slice(0, Math.max(0, room));
  const boundary = cut.lastIndexOf(" ");
  return {
    text: (boundary > 0 ? cut.slice(0, boundary) : cut).trim(),
    clipped: true,
  };
}
