import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import type { StagedPhoto } from "@/lib/chat/use-chat-channel";
import { useCleanDictation, type MemberAvatarTint } from "@repo/hooks";
import {
  ASK_COPY,
  ASK_DICTATION_MAX_LENGTH,
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  type MentionCandidate,
  type MentionPick,
  withoutObjectReplacement,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { useDictation } from "@/lib/dictation/use-dictation";
import {
  DICTATION_COPY,
  DictationDone,
  DictationHeard,
  DictationListening,
  DictationMic,
  DictationNotice,
  DictationOriginal,
  DictationTidying,
  joinDictated,
} from "@/components/dictation/dictation-controls";
import { CloseGlyph, RetryGlyph } from "@/components/control-glyphs";
import {
  MentionPicker,
  mentionPickFor,
  useMentionPicker,
  type MentionRoleRow,
} from "./mention-picker";
import { ON_MEDIA_DISC, ON_MEDIA_INK } from "./on-media";
import {
  type ChapterBranding,
  useChapterBranding,
} from "@/lib/chapter-branding";

/**
 * The s05 composer (`canvas-screens.dc.html:186-189`).
 *
 * The board draws a 44pt input between a 38pt attach button and a 38pt send
 * button, above a top hairline. The buttons here take the 44pt touch floor
 * instead (components.md §2), and one line of input measures exactly that
 * height, so the three share a top and a bottom edge until the draft wraps
 * (`INPUT_LINE_HEIGHT`).
 *
 * **Send lights up when there is something to send.** It paints the chapter's
 * solid accent (`accentPrimary` under `accentOnPrimary`, the pairing the chat
 * cards and a poll's chosen option use), and nothing sendable draws it in the
 * attach button's neutral recipe instead. A faded accent read as a muddy
 * square rather than "not yet", and two different accent recipes sat side by
 * side in the thread.
 *
 * The attach affordance used to be omitted here. The docblock said why — the
 * upload endpoint existed (`POST /v1/channels/{id}/upload-url`) but a picker,
 * progress and failure states were their own surface, and a disabled button
 * that never becomes enabled reads as a bug. That surface is now built
 * (`lib/chat/attachment-upload.ts`), so the button is real, and the three
 * states it needed are the ones handled below: picking (spinner in place of
 * the glyph while the system sheet is up), refused (the hint line, in the
 * error tone), and staged.
 *
 * **Staged photos are pictures, not filenames.** The tray above the input
 * draws each photo the member picked as a square thumbnail from the file on
 * the phone, the moment the picker closes. Its upload runs in the background:
 * an uploading photo draws faded (the pending rule, components.md §10: gray
 * until sent, no spinner, nothing moves), a ready one at full strength, and a
 * failed one dimmed under a try-again glyph the member taps. Send never waits
 * on the tray (`send` in `use-chat-channel.ts`).
 *
 * **Reply and Edit stage above the input** (#2775) as one strip, `context`:
 * "Replying to <name>" with the parent's preview, or "Editing message". The
 * strip is the member's only sign that the next send is not an ordinary
 * message, so it always carries a cancel. While editing, the send control
 * saves the edit and says so to a screen reader, and the caller withholds the
 * attach control, since an edit changes text only.
 *
 * **Choosing Reply or Edit puts the caret in the input** (2026-11-07). The
 * strip alone left the keyboard down, so an edit took a second tap on a box
 * that looked idle, and testers read it as slow to open. While editing, the
 * input sets the message's own line height and grows to `EDIT_MAX_LINES`
 * before it scrolls: a long message squeezed into the drafting box's five
 * tight lines read as shrunk, and the member could not see what they were
 * changing.
 *
 * **`@` opens a member picker** above the input, as web's composer does: the
 * members whose name holds what follows the `@`, from `mentionCandidates`,
 * then the roles this member may ping, from `mentionRoles` (2026-11-06).
 * Picking one writes `@` and their label (`mentionPickLabel` in
 * `@repo/validation`: the name as written, "Jane Doe", when it reads back whole) in place of what was typed, so the body is the plain text
 * a typed handle would be and the server resolves it as one. A space, or moving
 * the caret out of the handle, closes it; with no member matching it says so,
 * as web's does.
 *
 * **Frapp is in that list for a member with Ask** (`ask`, #4713), as its
 * first row (#5476; the order is `mentionPickerRows`'s), with the crest and
 * "Only you see the answer". A message that names `@Frapp` is a question for Frapp
 * and is never posted (`components/ask/ask-in-channel.tsx`); the screen
 * decides that on Send, and while the draft names it the send button is
 * called "Ask Frapp" and the screen says above the composer that only the
 * member will see it.
 *
 * **A long press on Send schedules the message** (`onSchedule`, #4956), as
 * Slack's phone app does: it opens Schedule message, and a screen reader gets
 * the same as a "Schedule message" action on Send. While the member has
 * messages scheduled in the channel, a line above the input says how many and
 * when the next goes (`scheduled`), and opens their list.
 *
 * This is a plain `TextInput`, deliberately. `BottomSheetTextInput` is mandatory
 * only *inside* a gorhom sheet (`spec/ui/mobile/patterns.md` § Bottom sheets);
 * the thread is a full route, so a plain input is correct and a sheet input
 * would break outside its host.
 */

/** What the next send does besides posting: answer a message, or save an edit. */
export interface ComposerContext {
  kind: "reply" | "edit";
  /** The strip's first line: `Replying to <name>` or `Editing message`. */
  title: string;
  /** One line of what is being replied to or edited, or `null` for none. */
  preview: string | null;
  onCancel: () => void;
}

/** The strip's cancel, spoken. */
function composerCancelLabel(kind: ComposerContext["kind"]): string {
  return kind === "reply" ? "Cancel reply" : "Cancel edit";
}

export interface ChatComposerProps {
  value: string;
  onChangeText: (next: string) => void;
  onSend: () => void;
  /** False while the runtime has no identity, or while offline. */
  canSend: boolean;
  placeholder: string;
  /** Status line above the input — a disabled reason, or a send failure. */
  disabledHint?: string | null;
  /** `error` paints the hint in `semantic.destructive`. Defaults to muted. */
  hintTone?: "muted" | "error";
  /** Photos staged for the next send, each uploading, ready or failed. */
  photos?: StagedPhoto[];
  /**
   * Opens the + sheet (#3865, trimmed in #5772: Photo, GIF, Poll, Event,
   * Task), which says itself what can't be used and why. Omit to render no + at all, as
   * while editing, rather than an inert one.
   */
  onOpenPlus?: () => void;
  /**
   * What the + says to a screen reader, where it opens something narrower
   * than the full sheet: a message thread's + opens the GIF picker (#4657).
   */
  plusLabel?: string;
  /**
   * Holds the + dark, still visible, where nothing it offers can work: a
   * channel the member can't post in. The reason rides `disabledHint`.
   */
  plusDisabled?: boolean;
  onRemovePhoto?: (key: string) => void;
  onRetryPhoto?: (key: string) => void;
  /** The system photo sheet is up; the attach control shows a spinner and locks. */
  isPicking?: boolean;
  /** A staged reply or an edit in progress; `null` for an ordinary send. */
  context?: ComposerContext | null;
  /**
   * Who `@` offers: the chapter roster, as web's picker reads it. `undefined`
   * while it loads, which offers nothing rather than "No matching members".
   */
  mentionCandidates?: readonly MentionCandidate[];
  /** A member's photo for their picker row; without it, initials. */
  avatarFor?: (userId: string) => string | null;
  /** A member's initials paint for their picker row (#3860). */
  avatarTintFor?: (userId: string) => MemberAvatarTint;
  /**
   * The roles `@` offers after the members (`GET /v1/channels/mention-roles`),
   * each saying whether this member may ping it. `undefined` while it loads,
   * which offers members only.
   */
  mentionRoles?: readonly MentionRoleRow[];
  /**
   * A member picked from the `@` list (#3835): who, and the label written
   * for them. The parent sends it beside the body, so the pick reaches that
   * member or nobody even if the roster changes before it lands.
   */
  onPickMember?: (pick: MentionPick) => void;
  /**
   * A member with Ask, in a composer that can ask from where it is (#4713):
   * `@` offers Frapp. `naming` is true while the draft names `@Frapp`, so
   * Send will ask instead of posting. Null or absent for everyone else.
   */
  ask?: { naming: boolean } | null;
  /**
   * Opens Schedule message (#4956), from a long press on Send or a screen
   * reader's "Schedule message" action. Omit where nothing can be scheduled
   * (an edit, a channel the member can't post in).
   */
  onSchedule?: () => void;
  /**
   * The line above the input while the member has messages scheduled here:
   * its words, how many didn't send, and what a tap on it opens. `null` for
   * none.
   */
  scheduled?: { label: string; failed: number; onOpen: () => void } | null;
}

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  canSend,
  placeholder,
  disabledHint,
  hintTone = "muted",
  photos = [],
  onOpenPlus,
  plusLabel = "Add a photo, poll, event and more",
  plusDisabled = false,
  onRemovePhoto,
  onRetryPhoto,
  isPicking = false,
  context = null,
  mentionCandidates,
  avatarFor,
  avatarTintFor,
  mentionRoles,
  onPickMember,
  ask = null,
  onSchedule,
  scheduled = null,
}: ChatComposerProps) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const { height: windowHeight } = useWindowDimensions();
  const inputRef = useRef<TextInput>(null);
  const contextKind = context?.kind ?? null;
  // Reply and Edit are both "type now": open the keyboard with the strip.
  // Keyed on the kind, so it runs when one starts, not on every keystroke.
  useEffect(() => {
    if (contextKind) inputRef.current?.focus();
  }, [contextKind]);
  const isEditing = contextKind === "edit";
  const mention = useMentionPicker(
    inputRef,
    value,
    onChangeText,
    mentionCandidates,
    mentionRoles,
    ask !== null,
  );
  const sendClear = useClearedOnSend(inputRef, value);
  // An edit opened just after a send is the member's own typing: nothing in
  // it is the box's leftover copy of what was sent.
  const endSendWindow = sendClear.endWindow;
  useEffect(() => {
    if (isEditing) endSendWindow();
  }, [isEditing, endSendWindow]);

  // Dictation (#5772, Ask's own from #5276): talk, tap Done, and the tidied
  // words land in the box to read and send. `valueRef` is the box as it is
  // when they land, not as it was when listening began.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  // Tidied words just landed: what the Original chip puts back, until the
  // member types or sends.
  const [original, setOriginal] = useState<{
    tidied: string;
    restore: string;
  } | null>(null);
  const cleanDictation = useCleanDictation();
  const roomLeft =
    CHAT_MESSAGE_CONTENT_MAX_LENGTH -
    (value.trim() ? value.trimEnd().length + 1 : 0);
  const dictation = useDictation({
    clean: cleanDictation,
    // One go is capped by what the cleanup takes, as well as by the message.
    room: Math.min(ASK_DICTATION_MAX_LENGTH, roomLeft),
    onText: (text, heard) => {
      const before = valueRef.current;
      const tidied = joinDictated(
        before,
        text,
        CHAT_MESSAGE_CONTENT_MAX_LENGTH,
      );
      const restore = joinDictated(
        before,
        heard,
        CHAT_MESSAGE_CONTENT_MAX_LENGTH,
      );
      onChangeText(tidied);
      setOriginal(tidied === restore ? null : { tidied, restore });
    },
  });
  const listening = dictation.phase === "listening";
  const tidying = dictation.phase === "cleaning";
  const canDictate = dictation.available && canSend && roomLeft > 0;

  // An empty or whitespace-only body is not a send — unless a photo is
  // staged. A photo-only message is a real message, uploaded or still
  // uploading, and gating it on the text alone would strand it with the send
  // button greyed out and no way to explain why. A body that is only U+FFFC,
  // the placeholder a keyboard leaves for a sticker it couldn't insert, is
  // empty too: the server saves it as spaces and refuses it (#4346).
  const isSendable =
    canSend &&
    !tidying &&
    (withoutObjectReplacement(value).trim().length > 0 || photos.length > 0);

  // The sheet greys what can't work this second and says why, so the + itself
  // only waits for the photo library it opened and for the chat runtime.
  const canOpenPlus = !!onOpenPlus && !plusDisabled && !isPicking && canSend;
  // Scheduling saves no edit, so an edit doesn't offer it. A draft naming
  // `@Frapp` does: the sheet says it can't be scheduled, where a long press
  // that fell through to Send would ask Frapp on release.
  const canSchedule = !!onSchedule && isSendable && !isEditing;

  return (
    <View style={styles.wrapper}>
      {disabledHint ? (
        <Text
          // Announced rather than silently painted: a send failure is the one
          // hint a member must not miss, and colour alone would not reach a
          // screen reader.
          accessibilityLiveRegion="polite"
          style={hintTone === "error" ? styles.hintError : styles.hint}
        >
          {disabledHint}
        </Text>
      ) : null}

      {scheduled ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            scheduled.failed > 0
              ? `${scheduled.label}, ${scheduled.failed} not sent`
              : scheduled.label
          }
          accessibilityHint="Opens your scheduled messages."
          hitSlop={{ top: 8, bottom: 8 }}
          onPress={scheduled.onOpen}
          style={({ pressed }) => [
            styles.scheduled,
            pressed ? styles.pressed : null,
          ]}
        >
          <ScheduledGlyph color={tokens.color.text.mutedForeground} />
          <Text numberOfLines={1} style={styles.scheduledText}>
            {scheduled.label}
            {scheduled.failed > 0 ? (
              <Text style={styles.scheduledFailed}>
                {` · ${scheduled.failed} not sent`}
              </Text>
            ) : null}
          </Text>
        </Pressable>
      ) : null}

      {context ? (
        <View style={styles.context}>
          <View style={styles.contextText}>
            <Text numberOfLines={1} style={styles.contextTitle}>
              {context.title}
            </Text>
            {context.preview ? (
              <Text numberOfLines={1} style={styles.contextPreview}>
                {context.preview}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={composerCancelLabel(context.kind)}
            hitSlop={14}
            onPress={context.onCancel}
            style={({ pressed }) => [
              styles.chipRemove,
              pressed ? styles.pressed : null,
            ]}
          >
            <CloseGlyph color={tokens.color.text.muted} size={16} />
          </Pressable>
        </View>
      ) : null}

      {photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.tray}
        >
          {photos.map((photo, index) => {
            const label = `Photo ${index + 1} of ${photos.length}`;
            return (
              <View key={photo.key} style={styles.thumb}>
                <Pressable
                  accessibilityRole={
                    photo.status === "failed" ? "button" : "image"
                  }
                  accessibilityLabel={
                    photo.status === "failed"
                      ? `${label}, didn't upload. Try again`
                      : photo.status === "uploading"
                        ? `${label}, uploading`
                        : label
                  }
                  disabled={photo.status !== "failed"}
                  onPress={() => onRetryPhoto?.(photo.key)}
                  style={styles.thumbFill}
                >
                  <Image
                    source={{ uri: photo.previewUri }}
                    resizeMode="cover"
                    style={[
                      styles.thumbFill,
                      photo.status !== "ready" ? styles.thumbPending : null,
                    ]}
                  />
                  {photo.status === "failed" ? (
                    <View style={styles.thumbFailed}>
                      <RetryGlyph
                        color={tokens.color.semantic.destructive}
                        size={22}
                      />
                    </View>
                  ) : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${label.toLowerCase()}`}
                  // 24 + 10 each side reaches the 44pt floor (§2), all of it
                  // inside the thumb, where Android delivers touches.
                  hitSlop={10}
                  onPress={() => onRemovePhoto?.(photo.key)}
                  style={({ pressed }) => [
                    styles.thumbRemove,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <CloseGlyph color={ON_MEDIA_INK} size={14} />
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {mention.open ? (
        <MentionPicker
          avatarFor={avatarFor}
          avatarTintFor={avatarTintFor}
          suggestions={mention.suggestions}
          onPick={(entry) => {
            mention.pick(entry.label);
            const pick = mentionPickFor(entry);
            if (pick) onPickMember?.(pick);
          }}
        />
      ) : null}

      {listening ? <DictationHeard live={dictation.live} /> : null}
      {dictation.notice !== null && dictation.phase === "idle" ? (
        <DictationNotice
          failure={dictation.notice}
          onDismiss={dictation.dismiss}
          fullText={DICTATION_COPY.notice.fullMessage}
        />
      ) : null}
      {original !== null && dictation.phase === "idle" ? (
        <DictationOriginal
          onPress={() => {
            onChangeText(original.restore);
            setOriginal(null);
          }}
        />
      ) : null}

      <View style={styles.row}>
        {onOpenPlus ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={plusLabel}
            accessibilityState={{ disabled: !canOpenPlus, busy: isPicking }}
            disabled={!canOpenPlus}
            onPress={onOpenPlus}
            style={({ pressed }) => [
              styles.attach,
              !canOpenPlus ? styles.attachDisabled : null,
              pressed ? styles.pressed : null,
            ]}
          >
            {isPicking ? (
              <ActivityIndicator
                accessibilityLabel="Choosing photos"
                color={tokens.color.text.muted}
                size="small"
              />
            ) : (
              <Text style={styles.attachGlyph}>+</Text>
            )}
          </Pressable>
        ) : null}

        {listening || tidying ? (
          <View
            style={[
              styles.input,
              styles.dictating,
              listening
                ? {
                    borderColor: brand.accent,
                    backgroundColor: tint(brand.accent),
                  }
                : null,
            ]}
          >
            {listening ? (
              <DictationListening
                live={dictation.live}
                onCancel={dictation.cancel}
                accent={brand.accent}
              />
            ) : (
              <DictationTidying live={dictation.live} />
            )}
          </View>
        ) : (
          <View style={styles.field}>
            <TextInput
              ref={inputRef}
              accessibilityLabel={placeholder}
              editable={canSend}
              multiline
              onChangeText={(next) => {
                if (sendClear.isStaleEcho(next)) return;
                if (original !== null && next !== original.tidied) {
                  setOriginal(null);
                }
                mention.onChangeText(next);
              }}
              onSelectionChange={mention.onSelectionChange}
              onFocus={mention.onFocus}
              onBlur={mention.onBlur}
              placeholder={placeholder}
              placeholderTextColor={tokens.color.text.muted}
              style={
                isEditing
                  ? [
                      styles.input,
                      styles.inputEditing,
                      canDictate ? styles.inputWithMic : null,
                      // Never more than a third of the screen, so the message
                      // list and the strip stay in view above the keyboard.
                      {
                        maxHeight: Math.min(
                          editMaxHeight(tokens),
                          windowHeight / 3,
                        ),
                      },
                    ]
                  : canDictate
                    ? [styles.input, styles.inputWithMic]
                    : styles.input
              }
              value={value}
            />
            {canDictate ? (
              <View style={styles.mic}>
                <DictationMic
                  onPress={() => {
                    setOriginal(null);
                    dictation.start();
                  }}
                />
              </View>
            ) : null}
          </View>
        )}

        {listening ? (
          <DictationDone
            onPress={dictation.finish}
            fill={brand.accentPrimary}
            color={brand.accentOnPrimary}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              context?.kind === "edit"
                ? "Save edit"
                : ask?.naming
                  ? ASK_COPY.name
                  : "Send message"
            }
            accessibilityHint={
              ask?.naming && context?.kind !== "edit"
                ? ASK_COPY.only_you_hint
                : undefined
            }
            accessibilityState={{ disabled: !isSendable }}
            accessibilityActions={
              canSchedule
                ? [{ name: "schedule", label: "Schedule message" }]
                : undefined
            }
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "schedule") onSchedule?.();
            }}
            disabled={!isSendable}
            onLongPress={canSchedule ? onSchedule : undefined}
            onPress={() => {
              sendClear.markSent();
              setOriginal(null);
              dictation.dismiss();
              onSend();
            }}
            style={({ pressed }) => [
              styles.send,
              !isSendable ? styles.sendDisabled : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text
              style={[
                styles.sendGlyph,
                !isSendable ? styles.sendGlyphDisabled : null,
              ]}
            >
              ↑
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * The scheduled line's mark: a clock, stroked like the task sheet's time
 * field (`components/tasks/due-time-field.tsx`), where web draws lucide's
 * `CalendarClock`.
 */
function ScheduledGlyph({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Circle
        cx={12}
        cy={12}
        r={8.5}
        stroke={color}
        strokeWidth={1.9}
        fill="none"
      />
      <Path
        d="M12 7.5V12l3 2"
        stroke={color}
        strokeWidth={1.9}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * How long after Send the native box's leftover copy of the sent text can
 * still arrive. A keystroke JS had not read yet comes within a frame or two.
 * iOS autocorrect can be slower: a correction pending as Send is tapped (the
 * underlined "thsy" that would become "that") is committed by the keyboard
 * after the send, putting the whole corrected message back in the box, and in
 * Paul's report (iOS, 2026-11-17) it landed after the 300ms retry had run.
 * Nobody has measured how late it can come: three seconds is a guess, three
 * times the old window, and the match in `isCopyOfSent` is kept narrow so
 * the longer window costs little. react-native#29073 is the same race.
 */
const SENT_ECHO_MS = 3000;
/**
 * When the clear is retried after a send, or after a copy is turned away, in
 * milliseconds and on top of one a frame later: as a busy thread catches up,
 * then across the window in which a late autocorrect can still put the text
 * back without telling JS.
 */
const CLEAR_RETRIES_MS = [100, 300, 700, 1500, SENT_ECHO_MS] as const;
/** The shortest message, in code points, that gets a copy check at all. */
const ECHO_MIN = 3;

/** The words of `text`, split on whitespace. */
function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

/**
 * Edit distance between two sequences, counting a swap of neighbours as one
 * edit (so "teh" is one from "the"): optimal string alignment.
 */
function editDistance<T>(a: readonly T[], b: readonly T[]): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = best;
    }
  }
  return rows[a.length][b.length];
}

/**
 * Whether `next`, arriving just after a send of `sent`, is the box's leftover
 * copy of it rather than the member typing. The copy is the sent text, or it
 * with the keystroke or correction that was in flight applied, so it reads
 * almost the same word for word:
 *
 * - A message of several words: the copy has the same number of words, give
 *   or take one (autocorrect can split "submitproof"), and is at most 15% of
 *   its letters away from the sent text (at least 2). A prediction or a
 *   first word tapped into the empty box is one word, so it is never taken
 *   for a longer message's copy, and dictating the next message only trips
 *   it when it is nearly the same message.
 * - A message of one word: the copy is one word too, and is the same word
 *   with a letter or two added, removed, changed or swapped, in any case
 *   ("thnaks" back as "Thanks"). A one-word prediction tapped within the
 *   window that is that close to the word just sent is taken for the copy:
 *   the price of catching the copy at all.
 *
 * A message shorter than `ECHO_MIN` code points has no copy check, since a
 * member repeating "k" or an emoji types exactly what was sent.
 */
function isCopyOfSent(next: string, sent: string): boolean {
  if (Array.from(sent.trim()).length < ECHO_MIN) return false;
  const was = wordsOf(sent);
  const now = wordsOf(next);
  if (now.length === 0) return false;
  if (was.length === 1) {
    if (now.length !== 1) return false;
    const before = Array.from(was[0].toLocaleLowerCase());
    const after = Array.from(now[0].toLocaleLowerCase());
    return editDistance(before, after) <= 2;
  }
  if (now.length < 2 || Math.abs(now.length - was.length) > 1) return false;
  const before = Array.from(was.join(" "));
  const after = Array.from(now.join(" "));
  const allowed = Math.max(2, Math.floor(before.length * 0.15));
  if (Math.abs(before.length - after.length) > allowed) return false;
  return editDistance(before, after) <= allowed;
}

/**
 * Makes the box on screen actually empty after a send, not only the draft.
 *
 * A send empties the draft, and React Native passes that to the native field
 * as a `setTextAndSelection` command stamped with the last event count JS has
 * seen. The native field drops a command whose count is behind its own, so if
 * the keyboard had sent an event JS hadn't caught up with when Send was tapped
 * (the last keystroke, an autocorrect or a prediction settling), the clear is
 * thrown away and the sent text stays in the box. The draft then reads empty
 * while the box doesn't, the next keystroke reports the whole old text plus
 * the new letter, and the member can send it again (Winston on iOS,
 * 2026-11-12, #4632; react-native#37722, and Expensify's same composer bug in
 * Expensify/App#37896).
 *
 * iOS autocorrect is a later form of the same thing (Paul, 2026-11-17): a
 * correction pending at the tap is committed after the send, and the whole
 * message comes back with the word fixed ("...do thsy" sent, "...do that"
 * back in the box), after the early retries. Reports on react-native#29073
 * say it doesn't always reach JS as a change; that is not checked on a device
 * here, so both are covered.
 *
 * - A change carrying the box's copy of the sent text (`isCopyOfSent`) is
 *   turned away by `isStaleEcho`. The input then sees its text differ from
 *   `value` and sends the draft again, stamped with the newer count, which
 *   the field accepts. The retries below also start over from that moment,
 *   in case the resend is dropped too.
 * - A copy that never reaches JS is cleared by retrying the clear through
 *   `SENT_ECHO_MS` (`CLEAR_RETRIES_MS`) while the draft is still empty. A
 *   retry against a field the member has typed into since is dropped by the
 *   same count check, so it can't take their new letters, and one against an
 *   already empty field changes nothing. After an edit's save hands back a
 *   non-empty draft there is no retry, so a silent copy there is not caught.
 *
 * The check runs within `SENT_ECHO_MS` of the tap, while the draft is no
 * longer the sent text, unless the change reads as typing onto the draft (an
 * edit's save hands the box back the member's draft, and that is theirs to
 * type on). The first change that isn't a copy closes the window, and so
 * does opening an edit (`endWindow`), so once the member has typed a letter
 * of the next message nothing is turned away.
 *
 * What is sent is what the box showed at the tap, typo included: JS learns
 * of the correction only after the message has gone.
 */
function useClearedOnSend(
  inputRef: RefObject<TextInput | null>,
  value: string,
) {
  const valueRef = useRef(value);
  // In the layout phase, as RN re-arms `clear()` with the new event count: a
  // retry that fires between the commit and the passive effects would read a
  // stale empty draft and wipe the member's first letter.
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);
  const sent = useRef<{
    text: string;
    at: number;
    echoOpen: boolean;
    /** When the retries count from: the tap, or the last turned-away copy. */
    retryFrom: number;
  } | null>(null);
  const [echoes, setEchoes] = useState(0);

  const markSent = useCallback(() => {
    const at = Date.now();
    sent.current = {
      text: valueRef.current,
      at,
      echoOpen: true,
      retryFrom: at,
    };
  }, []);

  const endWindow = useCallback(() => {
    if (sent.current) sent.current.echoOpen = false;
  }, []);

  useEffect(() => {
    const last = sent.current;
    if (value !== "" || !last || last.text === "") return;
    const now = Date.now();
    if (now - last.at > SENT_ECHO_MS) return;
    const elapsed = now - last.retryFrom;
    const clear = () => {
      if (valueRef.current === "") inputRef.current?.clear();
    };
    const frame = requestAnimationFrame(clear);
    const timers = CLEAR_RETRIES_MS.filter((at) => at > elapsed).map((at) =>
      setTimeout(clear, at - elapsed),
    );
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    };
    // `echoes` starts the retries over after a turned-away copy.
  }, [inputRef, value, echoes]);

  const isStaleEcho = useCallback((next: string) => {
    const last = sent.current;
    if (!last || !last.echoOpen) return false;
    const draft = valueRef.current;
    const now = Date.now();
    const echo =
      now - last.at <= SENT_ECHO_MS &&
      draft !== last.text &&
      isCopyOfSent(next, last.text) &&
      !(draft !== "" && (next.startsWith(draft) || draft.startsWith(next)));
    if (!echo) {
      last.echoOpen = false;
    } else {
      last.retryFrom = now;
      setEchoes((count) => count + 1);
    }
    return echo;
  }, []);

  return { markSent, isStaleEcho, endWindow };
}

/**
 * The input's line height. With body type's 16/25 and 12pt of padding above
 * and below, an empty input on the first Android build measured about 75pt
 * against its 44pt buttons, with the placeholder at the top of a box that
 * looked two lines tall. 20 sits close to the font's own height, so Android
 * (with its font padding off) and iOS lay one line out the same, and it is the
 * figure the vertical padding is worked out from.
 */
const INPUT_LINE_HEIGHT = 20;
const INPUT_BORDER = 1;
/** The dictation mic's size (`DictationMic`). */
const DICTATION_MIC = 32;
/** Lines an edit shows before it scrolls; a draft stops at `maxHeight: 120`. */
const EDIT_MAX_LINES = 10;

/** Vertical padding that keeps one line of `lineHeight` at the 44pt floor. */
function inputPaddingFor(tokens: SignetTokens, lineHeight: number): number {
  return (tokens.touch.minimum - lineHeight - 2 * INPUT_BORDER) / 2;
}

/** A message body's line height, which an edit is typed at. */
function messageLineHeight(tokens: SignetTokens): number {
  return tokens.typography.role.body.lineHeight ?? 25;
}

/** The edit input's height at `EDIT_MAX_LINES` of message-height lines. */
function editMaxHeight(tokens: SignetTokens): number {
  const lineHeight = messageLineHeight(tokens);
  return (
    EDIT_MAX_LINES * lineHeight +
    2 * inputPaddingFor(tokens, lineHeight) +
    2 * INPUT_BORDER
  );
}

/** A staged photo's square: two lines of text tall, like iMessage's tray. */
const THUMB_SIZE = 64;
/** How far a thumb's remove badge sits in from its corner. */
const THUMB_BADGE_INSET = 4;

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  // What is left of the 44pt floor once one line and the border are drawn,
  // split above and below, so a one-line input is exactly button height.
  const inputPaddingY = inputPaddingFor(tokens, INPUT_LINE_HEIGHT);
  const editPaddingY = inputPaddingFor(tokens, messageLineHeight(tokens));
  return StyleSheet.create({
    wrapper: {
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm + 2,
      paddingBottom: tokens.spacing.sm + 2,
      gap: tokens.spacing.sm,
      backgroundColor: tokens.color.surface.background,
    },
    scheduled: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: tokens.spacing.xs,
    },
    scheduledText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      flexShrink: 1,
    },
    scheduledFailed: {
      color: tokens.color.semantic.destructiveText,
    },
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    hintError: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    tray: {
      gap: tokens.spacing.xs,
    },
    thumb: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
    },
    thumbFill: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: tokens.radius.control,
      overflow: "hidden",
      backgroundColor: tokens.color.surface.popover,
    },
    // Gray until sent (components.md §10): faded in place, nothing added.
    thumbPending: {
      opacity: 0.45,
    },
    thumbFailed: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    // A dark disc so the × reads over any photo, light or dark.
    thumbRemove: {
      position: "absolute",
      top: THUMB_BADGE_INSET,
      right: THUMB_BADGE_INSET,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: ON_MEDIA_DISC,
      alignItems: "center",
      justifyContent: "center",
    },
    // The quote rule a sent reply carries (`reply-quote.tsx`), so the staged
    // strip reads as the quote the message is about to show.
    context: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      borderLeftWidth: 2,
      borderLeftColor: tokens.color.border.hairline,
      paddingLeft: tokens.spacing.sm,
    },
    contextText: {
      flex: 1,
      minWidth: 0,
    },
    contextTitle: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    contextPreview: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    // A 16pt × with 14pt of slop on each side reaches the 44pt floor (§2)
    // without making the chip taller.
    chipRemove: {
      marginLeft: "auto",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: tokens.spacing.sm,
    },
    input: {
      flex: 1,
      minHeight: tokens.touch.minimum,
      // Multiline grows, but not without bound — past this the thread would be
      // pushed off screen by the composer alone.
      maxHeight: 120,
      borderRadius: tokens.radius.control,
      borderWidth: INPUT_BORDER,
      borderColor: tokens.color.border.control,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md + 2,
      // Top and bottom set apart, not `paddingVertical`: iOS gives a multiline
      // input a default top inset that only an explicit `paddingTop` replaces.
      paddingTop: inputPaddingY,
      paddingBottom: inputPaddingY,
      ...typeRole({
        ...tokens.typography.role.body,
        lineHeight: INPUT_LINE_HEIGHT,
      }),
      // `includeFontPadding` is Android's: off, a line is the line height and
      // no more, which the padding above counts on. Centring keeps the
      // placeholder on the buttons' midline should a device still measure the
      // empty field a little tall.
      includeFontPadding: false,
      textAlignVertical: "center",
      color: tokens.color.text.foreground,
    },
    // An edit is typed at the message's own line height; the padding keeps
    // one line at the 44pt floor, so the box only grows with the text.
    // The box holds the input and, at its right end, the dictation mic.
    field: {
      flex: 1,
    },
    // Room for the 32pt mic inside the box's right end.
    inputWithMic: {
      paddingRight: DICTATION_MIC + tokens.spacing.sm,
    },
    // 32pt centred in the one-line 44pt box, pinned to its foot as it grows.
    mic: {
      position: "absolute",
      right: (tokens.touch.minimum - DICTATION_MIC) / 2,
      bottom: (tokens.touch.minimum - DICTATION_MIC) / 2,
    },
    // The waveform or the pulsing words, in the box's own frame.
    dictating: {
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: tokens.spacing.sm,
    },
    inputEditing: {
      paddingTop: editPaddingY,
      paddingBottom: editPaddingY,
      lineHeight: messageLineHeight(tokens),
    },
    // Deliberately NOT the accent. The accent is the send affordance on this
    // row, and two accent controls either side of the input would give the
    // screen two primary actions.
    attach: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      alignItems: "center",
      justifyContent: "center",
    },
    attachDisabled: {
      opacity: 0.4,
    },
    attachGlyph: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.muted,
    },
    // A 1pt border in both states, so the box never shifts as the button flips
    // between them. Lit, it is painted the accent, the same as the fill, so it
    // reads as part of the fill; a lit fill that changes must change it too.
    send: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: brand.accentPrimary,
      backgroundColor: brand.accentPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    // The attach button's recipe: nothing to send is a resting control, not a
    // faded accent.
    sendDisabled: {
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
    },
    pressed: {
      opacity: 0.7,
    },
    sendGlyph: {
      ...typeRole(tokens.typography.role.title),
      color: brand.accentOnPrimary,
    },
    sendGlyphDisabled: {
      color: tokens.color.text.muted,
    },
  });
}
