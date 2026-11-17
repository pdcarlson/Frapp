import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectionHaptic } from "../haptics";
import {
  isDictationAvailable,
  requestDictationPermission,
  startDictation,
  type DictationFailure,
  type DictationSession,
} from "./speech";

/**
 * Dictation into Ask's field (#5276), as Paul picked it on 2026-11-17 from
 * the design page: tap the mic, talk while a waveform follows the voice, tap
 * the check, and the words land in the field tidied up (no fillers or false
 * starts, with punctuation). Nothing is sent by speaking: the member reads,
 * edits and taps send.
 *
 * Phases: `idle`, `listening` (the recogniser is on, words and level arrive)
 * and `cleaning` (the words are with Frapp's AI for about a second). The
 * cleanup is the caller's `clean`, which resolves the tidied text or `null`;
 * `null`, a timeout or no Frapp AI all leave the words as heard.
 */

export type DictationPhase = "idle" | "listening" | "cleaning";

/** How many level samples the waveform draws, newest last. */
export const DICTATION_LEVEL_SAMPLES = 28;

/**
 * Dictation stops itself after this long, as if the check were tapped. A
 * question is a sentence or three; this keeps a mic forgotten open from
 * running on.
 */
export const DICTATION_MAX_SECONDS = 120;

export interface UseDictationOptions {
  /** The cleanup pass: tidied text, or `null` to keep the words as heard. */
  clean: (text: string, options: { signal: AbortSignal }) => Promise<string | null>;
  /** The words are ready for the field: `text` tidied, `heard` as spoken. */
  onText: (text: string, heard: string) => void;
}

export interface Dictation {
  /** False in Expo Go, on web, and where the phone has no recogniser: draw no mic. */
  available: boolean;
  phase: DictationPhase;
  /** Everything heard so far, while listening. */
  words: string;
  /** The voice's recent levels, 0 to 1, oldest first. */
  levels: number[];
  /** Whole seconds since listening began. */
  seconds: number;
  /** Why the last try ended with nothing, until the next try or `dismiss`. */
  failure: DictationFailure | null;
  start: () => void;
  /** Stop listening and keep the words. */
  finish: () => void;
  /** Stop and drop everything. */
  cancel: () => void;
  dismiss: () => void;
}

export function useDictation({ clean, onText }: UseDictationOptions): Dictation {
  const available = useMemo(() => isDictationAvailable(), []);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [words, setWords] = useState("");
  const [levels, setLevels] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [failure, setFailure] = useState<DictationFailure | null>(null);

  const phaseRef = useRef<DictationPhase>("idle");
  const session = useRef<DictationSession | null>(null);
  const cleaning = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Bumped by every start and cancel, so a callback from an older try is
  // dropped rather than landing in the field after the member moved on.
  const attempt = useRef(0);
  const latest = useRef({ clean, onText });
  latest.current = { clean, onText };

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
    setWords("");
    setLevels([]);
    setSeconds(0);
  }, [stopTimer]);

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
  }, [enter, reset]);

  const start = useCallback(() => {
    if (!available || phaseRef.current !== "idle") return;
    const mine = ++attempt.current;
    setFailure(null);
    void (async () => {
      const granted = await requestDictationPermission();
      if (mine !== attempt.current) return;
      if (!granted) {
        setFailure("denied");
        return;
      }
      selectionHaptic();
      reset();
      enter("listening");
      const begun = startDictation({
        onWords: (heard) => {
          if (mine === attempt.current) setWords(heard);
        },
        onLevel: (level) => {
          if (mine !== attempt.current) return;
          setLevels((before) =>
            [...before, level].slice(-DICTATION_LEVEL_SAMPLES),
          );
        },
        onEnd: (heard) => {
          if (mine !== attempt.current) return;
          stopTimer();
          session.current = null;
          if (!heard.trim()) {
            reset();
            enter("idle");
            setFailure("no-speech");
            return;
          }
          enter("cleaning");
          const controller = new AbortController();
          cleaning.current = controller;
          void latest.current
            .clean(heard, { signal: controller.signal })
            .catch(() => null)
            .then((tidied) => {
              if (mine !== attempt.current) return;
              cleaning.current = null;
              const text = tidied?.trim() ? tidied.trim() : heard.trim();
              reset();
              enter("idle");
              latest.current.onText(text, heard.trim());
            });
        },
        onFailure: (why) => {
          if (mine !== attempt.current) return;
          reset();
          enter("idle");
          setFailure(why);
        },
      });
      if (mine !== attempt.current) return;
      if (!begun) {
        // `onFailure` has already said why, unless the module vanished.
        if (phaseRef.current === "listening") {
          reset();
          enter("idle");
          setFailure("unavailable");
        }
        return;
      }
      session.current = begun;
      let elapsed = 0;
      timer.current = setInterval(() => {
        elapsed += 1;
        setSeconds(elapsed);
        if (elapsed >= DICTATION_MAX_SECONDS) session.current?.finish();
      }, 1000);
    })();
  }, [available, enter, reset, stopTimer]);

  const dismiss = useCallback(() => setFailure(null), []);

  // Leaving the sheet drops whatever was in progress.
  useEffect(() => cancel, [cancel]);

  return {
    available,
    phase,
    words,
    levels,
    seconds,
    failure,
    start,
    finish,
    cancel,
    dismiss,
  };
}
