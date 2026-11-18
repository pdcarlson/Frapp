import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { codeOf } from "@repo/api-sdk";
import { useUpdateMeeting, type MeetingMinutes } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  MEETING_COPY,
  MEETING_TEXT_MAX_LENGTH,
  readMeetingContent,
} from "@repo/validation";
import { TextAction } from "@/components/minutes/recorder-controls";
import { sheetFieldStyles } from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** The stored Summary, read as the minutes screen reads every section. */
const summaryOf = (meeting: MeetingMinutes) =>
  readMeetingContent(meeting.content).summary;

/** How long typing rests before it saves: the web draft's own wait. */
export const SUMMARY_AUTOSAVE_MS = 1200;

export interface SummaryNoteHandle {
  /**
   * Saves what is typed, if anything is waiting, and answers the version to
   * post, or null when the save didn't land (stale, offline).
   */
  flush: () => Promise<string | null>;
}

/**
 * The note an officer types into where the chapter doesn't draft minutes
 * from notes (#5288; Paul's pick, 2026-11-17: "typed notes become the
 * minutes' Summary"). What is typed is the minutes' Summary section, saved
 * as the officer types the way the web's draft saves (`minutes-page.tsx`):
 * once typing rests, one save at a time, each naming the version it was
 * typed over, so a save over someone else's newer one is refused as stale
 * instead of overwriting it. A refusal keeps every word on screen and offers
 * their version.
 *
 * Decisions and action items have no phone editor yet (#4412); a line under
 * the note says where they are added.
 */
export const SummaryNote = forwardRef<
  SummaryNoteHandle,
  {
    meeting: MeetingMinutes;
    /** Reads the minutes again, for Load their version. */
    reload: () => Promise<MeetingMinutes | null>;
    /** Whether the note has words, for the screen's Post. */
    onWritten?: (written: boolean) => void;
  }
>(function SummaryNote({ meeting, reload, onWritten }, ref) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const update = useUpdateMeeting();

  const [text, setText] = useState(summaryOf(meeting));
  const [base, setBase] = useState(summaryOf(meeting));
  const [loadedAt, setLoadedAt] = useState(meeting.updated_at);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  const dirty = text.trim() !== base.trim();

  // The latest of each, for a save that ends after more typing.
  const textRef = useRef(text);
  const baseRef = useRef(base);
  const loadedAtRef = useRef(loadedAt);
  useLayoutEffect(() => {
    textRef.current = text;
    baseRef.current = base;
    loadedAtRef.current = loadedAt;
  });
  const inFlight = useRef<Promise<string | null> | null>(null);

  // A newer version arrived (a pull to refresh, a save on the web). With
  // nothing typed since, show it; with typing waiting, keep the typing and
  // let the next save be refused as stale, so nothing is lost either way.
  if (
    Date.parse(meeting.updated_at) > Date.parse(loadedAt) &&
    !dirty &&
    !update.isPending
  ) {
    setText(summaryOf(meeting));
    setBase(summaryOf(meeting));
    setLoadedAt(meeting.updated_at);
  }

  const written = text.trim() !== "";
  const reported = useRef<boolean | null>(null);
  useEffect(() => {
    if (reported.current === written) return;
    reported.current = written;
    onWritten?.(written);
  }, [written, onWritten]);

  async function save(): Promise<string | null> {
    while (inFlight.current) await inFlight.current;
    const sent = textRef.current.trim();
    if (sent === baseRef.current.trim()) return loadedAtRef.current;
    const run = (async () => {
      try {
        const saved = await update.mutateAsync({
          id: meeting.id,
          body: {
            expected_updated_at: loadedAtRef.current,
            content: { summary: sent },
          },
        });
        setFailed(false);
        loadedAtRef.current = saved.updated_at;
        baseRef.current = summaryOf(saved);
        setLoadedAt(saved.updated_at);
        setBase(summaryOf(saved));
        return saved.updated_at;
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
  }

  useImperativeHandle(ref, () => ({
    flush: () => (stale ? Promise.resolve(null) : save()),
  }));

  // Saves once typing rests. A failed save waits for the next keystroke.
  const pending = dirty && !stale && !failed;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => void save(), SUMMARY_AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // `save` reads the latest text through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, text]);

  // Leaving the screen sends what is still waiting, as the web does.
  const flushOnLeave = useRef(() => {});
  useEffect(() => {
    flushOnLeave.current = () => {
      if (!stale && textRef.current.trim() !== baseRef.current.trim())
        void save();
    };
  });
  useEffect(() => () => flushOnLeave.current(), []);

  async function loadTheirs() {
    const fresh = await reload();
    if (!fresh) return;
    setText(summaryOf(fresh));
    setBase(summaryOf(fresh));
    setLoadedAt(fresh.updated_at);
    setStale(false);
    setFailed(false);
  }

  return (
    <View style={styles.note}>
      <TextInput
        multiline
        value={text}
        maxLength={MEETING_TEXT_MAX_LENGTH}
        onChangeText={(next) => {
          setText(next);
          if (failed) setFailed(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={MEETING_COPY.summaryPlaceholder}
        placeholderTextColor={tokens.color.text.muted}
        accessibilityLabel="Summary"
        style={[
          styles.field,
          styles.fieldMultilineText,
          styles.box,
          focused ? styles.fieldFocused : null,
        ]}
      />
      {stale ? (
        <View style={styles.stale}>
          <Text accessibilityLiveRegion="polite" style={styles.problem}>
            {MEETING_COPY.stale}
          </Text>
          <TextAction
            label={MEETING_COPY.loadTheirs}
            color={accent}
            onPress={() => void loadTheirs()}
          />
        </View>
      ) : failed ? (
        <Text accessibilityLiveRegion="polite" style={styles.problem}>
          {MEETING_COPY.saveFailed}
        </Text>
      ) : null}
      <Text style={styles.hint}>{MEETING_COPY.restOnWeb}</Text>
    </View>
  );
});

function createStyles(tokens: SignetTokens, accent: string) {
  const caption = typeRole(tokens.typography.role.caption);
  return StyleSheet.create({
    ...sheetFieldStyles(tokens, accent),
    note: {
      gap: tokens.spacing.sm,
    },
    box: {
      minHeight: 160,
    },
    stale: {
      gap: tokens.spacing.xs,
    },
    problem: {
      ...caption,
      color: tokens.color.semantic.destructiveText,
    },
    hint: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
  });
}
