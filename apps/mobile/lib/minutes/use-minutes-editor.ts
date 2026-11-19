import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { codeOf } from "@repo/api-sdk";
import { useUpdateMeeting, type MeetingMinutes } from "@repo/hooks";
import {
  MINUTES_EDITOR_COPY,
  cleanMeetingContent,
  minutesEditDraftOf,
  sameMinutesDraft,
  type MeetingContent,
  type MeetingSectionKey,
  type MinutesEditDraft,
} from "@repo/validation";

/**
 * How long a draft's typing rests before it saves on its own: the web
 * editor's own wait (`minutes-page.tsx`), and the Summary note's.
 */
export const MINUTES_EDITOR_AUTOSAVE_MS = 1200;

export interface MinutesEditing {
  /** What is on screen, untrimmed and with rows still being filled in. */
  draft: MinutesEditDraft;
  /** Something typed would store differently from what is saved. */
  dirty: boolean;
  /** A save is out. */
  saving: boolean;
  /** Someone saved since this version was read: their version is offered. */
  stale: boolean;
  /** The last save didn't land for another reason (offline, a 500). */
  failed: boolean;
  /**
   * The draft's save state for its header ("Saving…", "Saved", "Not saved"),
   * or null where nothing saves on its own (posted minutes, a stale draft).
   */
  saveLine: string | null;
  /**
   * The sections the officer added or typed in this visit, which stay on
   * screen even emptied, so nothing vanishes from under the cursor.
   */
  kept: MeetingSectionKey[];
  edit: (patch: Partial<MeetingContent>) => void;
  keep: (key: MeetingSectionKey) => void;
  /** A new draft is coming: the sections kept so far start afresh. */
  clearKept: () => void;
  /** Starts a visit from these minutes: their words, nothing kept. */
  begin: (meeting: MeetingMinutes) => void;
  /** Puts back what is saved, for Cancel. */
  discard: () => void;
  /**
   * Saves what is on screen and answers the stored minutes, or null when the
   * save didn't land. Typing that arrives meanwhile goes with the next one.
   */
  save: () => Promise<MeetingMinutes | null>;
  /** Stale: drops what is typed for the newest version. */
  loadTheirs: () => Promise<void>;
  /** Whether the last save was refused as stale, read after awaiting one. */
  isStale: () => boolean;
}

/**
 * The phone's minutes editor's state and saves (#4412), the web editor's
 * (`apps/web/components/meetings/minutes-page.tsx`) in a hook: the same
 * draft, the same notion of "changed" (`sameMinutesDraft`), the same
 * compare-and-set save naming the version it was typed over, one save at a
 * time, and a stale refusal that keeps every word typed and offers their
 * version. A draft saves itself once typing rests and as the screen goes;
 * posted minutes wait for Save, since members already read them (Paul,
 * 2026-11-16).
 *
 * Only the words are sent: the type is Edit details' (#5562), which saves it
 * on its own.
 */
export function useMinutesEditor({
  meeting,
  active,
  autosave,
  reload,
}: {
  meeting: MeetingMinutes;
  /** The screen is in edit mode. */
  active: boolean;
  /** A draft: saves as typing rests, with no Save button. */
  autosave: boolean;
  /** Reads the minutes again, for Load their version. */
  reload: () => Promise<MeetingMinutes | null>;
}): MinutesEditing {
  const update = useUpdateMeeting();
  const [base, setBase] = useState(() => minutesEditDraftOf(meeting));
  const [draft, setDraft] = useState(base);
  // The version `base` was read from. Every save names it, so a save made on
  // an older version is refused rather than overwriting a newer one.
  const [loadedAt, setLoadedAt] = useState(meeting.updated_at);
  const [stale, setStaleState] = useState(false);
  const staleRef = useRef(false);
  const setStale = useCallback((next: boolean) => {
    staleRef.current = next;
    setStaleState(next);
  }, []);
  const [failed, setFailed] = useState(false);
  const [kept, setKept] = useState<MeetingSectionKey[]>([]);
  const dirty = !sameMinutesDraft(draft, base);

  // The latest of each, for a save that ends after more typing.
  const draftRef = useRef(draft);
  const baseRef = useRef(base);
  const loadedAtRef = useRef(loadedAt);
  useLayoutEffect(() => {
    draftRef.current = draft;
    baseRef.current = base;
    loadedAtRef.current = loadedAt;
  });
  const inFlight = useRef<Promise<MeetingMinutes | null> | null>(null);

  // Takes a version as both what is saved and what is on screen. The refs
  // follow in the layout effect above; a caller that awaits more first sets
  // them itself (`adopt`).
  const show = (next: MeetingMinutes) => {
    const fresh = minutesEditDraftOf(next);
    setBase(fresh);
    setDraft(fresh);
    setLoadedAt(next.updated_at);
    return fresh;
  };
  const adopt = useCallback((next: MeetingMinutes) => {
    const fresh = minutesEditDraftOf(next);
    baseRef.current = fresh;
    draftRef.current = fresh;
    loadedAtRef.current = next.updated_at;
    setBase(fresh);
    setDraft(fresh);
    setLoadedAt(next.updated_at);
  }, []);

  // A newer version arrived (a pull to refresh, a draft landing, a save on
  // the web). With nothing typed, take it; with typing on screen, keep the
  // typing and let the next save be refused as stale, so nothing is lost.
  if (
    Date.parse(meeting.updated_at) > Date.parse(loadedAt) &&
    !dirty &&
    !update.isPending
  ) {
    show(meeting);
  }

  const save = useCallback(async (): Promise<MeetingMinutes | null> => {
    // Every save waiting on this one checks again when it ends, so two never
    // go out on the same version and refuse each other as stale.
    while (inFlight.current) await inFlight.current;
    const sent = draftRef.current;
    if (sameMinutesDraft(sent, baseRef.current)) {
      return { ...meeting, updated_at: loadedAtRef.current };
    }
    const run = (async () => {
      try {
        const saved = await update.mutateAsync({
          id: meeting.id,
          body: {
            expected_updated_at: loadedAtRef.current,
            content: cleanMeetingContent(sent.content),
          },
        });
        setFailed(false);
        const stored = minutesEditDraftOf(saved);
        loadedAtRef.current = saved.updated_at;
        baseRef.current = stored;
        setLoadedAt(saved.updated_at);
        // The screen keeps what is typed, untrimmed and with rows still being
        // filled in; it counts as saved because it stores the same.
        setBase(stored);
        return saved;
      } catch (error) {
        if (codeOf(error) === "meeting.stale") setStale(true);
        else setFailed(true);
        return null;
      }
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      if (inFlight.current === run) inFlight.current = null;
    }
  }, [meeting, update, setStale]);

  // A draft saves itself once typing rests. A failed save waits for the next
  // keystroke, which clears it.
  const pending = active && autosave && dirty && !stale && !failed;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => void save(), MINUTES_EDITOR_AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // `save` reads the latest draft through refs; `draft` restarts the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, draft]);

  // Leaving the screen sends what a draft still has waiting, as the web's
  // in-app navigation does.
  const flushOnLeave = useRef(() => {});
  useEffect(() => {
    flushOnLeave.current = () => {
      if (
        active &&
        autosave &&
        !stale &&
        !sameMinutesDraft(draftRef.current, baseRef.current)
      )
        void save();
    };
  });
  useEffect(() => () => flushOnLeave.current(), []);

  const edit = useCallback((patch: Partial<MeetingContent>) => {
    const touched = Object.keys(patch) as MeetingSectionKey[];
    setKept((current) =>
      touched.every((key) => current.includes(key))
        ? current
        : [...current, ...touched.filter((key) => !current.includes(key))],
    );
    setFailed(false);
    setDraft((current) => ({
      ...current,
      content: { ...current.content, ...patch },
    }));
  }, []);

  const keep = useCallback((key: MeetingSectionKey) => {
    setKept((current) => (current.includes(key) ? current : [...current, key]));
  }, []);

  const clearKept = useCallback(() => setKept([]), []);

  const begin = useCallback(
    (next: MeetingMinutes) => {
      adopt(next);
      setKept([]);
      setStale(false);
      setFailed(false);
    },
    [adopt, setStale],
  );

  const discard = useCallback(() => {
    setDraft(baseRef.current);
    draftRef.current = baseRef.current;
    setKept([]);
    setFailed(false);
  }, []);

  const loadTheirs = useCallback(async () => {
    const fresh = await reload();
    if (!fresh) {
      setFailed(true);
      return;
    }
    adopt(fresh);
    setStale(false);
    setFailed(false);
  }, [adopt, reload, setStale]);

  const isStale = useCallback(() => staleRef.current, []);

  const saveLine =
    !autosave || stale
      ? null
      : failed
        ? MINUTES_EDITOR_COPY.notSaved
        : update.isPending || dirty
          ? MINUTES_EDITOR_COPY.saving
          : MINUTES_EDITOR_COPY.saved;

  return {
    draft,
    dirty,
    saving: update.isPending,
    stale,
    failed,
    saveLine,
    kept,
    edit,
    keep,
    clearKept,
    begin,
    discard,
    save,
    loadTheirs,
    isStale,
  };
}
