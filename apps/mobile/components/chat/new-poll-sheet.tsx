import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { buildPollMessage, type PollPayload } from "@repo/chat-core/polls";
import { SignetTokens } from "@repo/theme/signet";
import {
  POLL_OPTION_MAX_LENGTH,
  POLL_OPTIONS_MAX,
  POLL_QUESTION_MAX_LENGTH,
} from "@repo/validation";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { FilterChips } from "@/components/filter-chips";
import { MoreOptionsRow } from "@/components/more-options-row";
import { IconButton } from "@/components/icon-button";
import { CloseGlyph, DisclosureGlyph } from "@/components/control-glyphs";
import { successHaptic } from "@/lib/haptics";
import {
  addPollOption,
  canAddPollOption,
  canRemovePollOption,
  checkPollDraft,
  closesAtFor,
  emptyPollDraft,
  movePollOption,
  POLL_CLOSE_CHOICES,
  removePollOption,
  setPollOption,
  type PollCloseChoice,
  type PollDraft,
} from "@/lib/chat/new-poll";

/**
 * s05's New poll sheet (#3701): an officer on their phone in the group chat
 * asks "who's driving Saturday" without going to a laptop. Opened from the
 * composer's +, it posts a poll card into the channel the thread is showing,
 * the card web's `/poll` posts and both clients vote on (`buildPollMessage`
 * in `@repo/chat-core/polls`).
 *
 * The form: a question, two to ten options (add, remove, and move up or
 * down), and **More options** for when voting stops, a day by default as on
 * web. A chat-card poll is single-choice and has no early close yet, on any
 * client; both are their own work.
 *
 * Posting goes through the outbox like any message, so it is optimistic and
 * survives a lost connection, and a server refusal (Polls switched off since
 * the sheet opened, say) lands on the card's own failed row with Retry and
 * Discard. What this sheet reports itself is only an outbox that refused the
 * row, when nothing was queued and the draft is all the member has.
 *
 * The draft outlives a close, not a Cancel (`spec/ui/mobile/patterns.md`
 * § Bottom sheets), and the host mounts a new sheet per channel, so a kept
 * draft never posts into a channel it wasn't written for.
 */

export interface NewPollSheetProps {
  /** Queues the card; `useChatChannel`'s `sendPoll`. */
  onPost: (poll: {
    content: string;
    payload: PollPayload;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Injected so the close time is deterministic under test. */
  now?: () => Date;
}

type Focus = "question" | number | null;

export const NewPollSheet = forwardRef<BottomSheetModal, NewPollSheetProps>(
  function NewPollSheet({ onPost, now }, ref) {
    const { tokens } = useFrappTheme();
    const brand = useChapterBranding();
    const styles = createStyles(tokens, brand);
    const backgroundStyle = useSheetBackgroundStyle();
    const closeSheet = useSheetClose(ref);
    const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
      useSheetVisit(ref);

    const [draft, setDraft] = useState<PollDraft>(emptyPollDraft);
    const [showMore, setShowMore] = useState(false);
    const [focused, setFocused] = useState<Focus>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [posting, setPosting] = useState(false);
    // Set the moment Post is pressed, before `posting` reaches a render, so a
    // second tap in the same batch can't queue the poll twice.
    const sending = useRef(false);

    const check = useMemo(() => checkPollDraft(draft), [draft]);
    const canPost = check.ok && !posting;
    const closesLabel =
      POLL_CLOSE_CHOICES.find((each) => each.id === draft.closes)?.label ??
      "1 day";

    const edit = useCallback((next: (current: PollDraft) => PollDraft) => {
      setDraft(next);
      setFailure(null);
    }, []);

    /** Cancel and a post that landed: the draft is given up. */
    const reset = useCallback(() => {
      setDraft(emptyPollDraft());
      setShowMore(false);
      setFocused(null);
      setFailure(null);
    }, []);

    /** A swipe or scrim close keeps the draft for the next visit. */
    const closed = useCallback(() => {
      markClosed();
      setFocused(null);
      setFailure(null);
    }, [markClosed]);

    const cancel = useCallback(() => {
      if (sending.current) return;
      reset();
      dismiss();
    }, [reset, dismiss]);

    const post = useCallback(() => {
      if (!check.ok || sending.current) return;
      sending.current = true;
      setPosting(true);
      setFailure(null);
      const sentFrom = visit();
      const poll = buildPollMessage({
        question: check.question,
        options: check.options,
        closesAt: closesAtFor(draft.closes, now ? now() : new Date()),
      });
      void onPost(poll).then((result) => {
        sending.current = false;
        setPosting(false);
        if (result.ok) {
          successHaptic();
          // The card is in the thread, so the draft goes whichever visit is
          // on screen: keeping it would invite a second poll.
          reset();
          if (isSameVisit(sentFrom)) dismiss();
          return;
        }
        if (isSameVisit(sentFrom)) setFailure(result.error);
      });
    }, [check, draft.closes, now, onPost, reset, dismiss, visit, isSameVisit]);

    const problem = failure ?? (check.ok ? null : check.problem);

    return (
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onAnimate={onAnimate}
        onDismiss={closed}
      >
        <SheetBackToClose onClose={closeSheet} />
        <BottomSheetScrollView
          onAccessibilityEscape={closeSheet}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <SheetHeader
            title="New poll"
            onCancel={cancel}
            cancelDisabled={posting}
          />

          <View
            style={[
              styles.ring,
              focused === "question" ? styles.ringActive : null,
            ]}
          >
            <BottomSheetTextInput
              value={draft.question}
              onChangeText={(question) =>
                edit((current) => ({ ...current, question }))
              }
              onFocus={() => setFocused("question")}
              onBlur={() => setFocused(null)}
              editable={!posting}
              placeholder="Ask a question"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Poll question"
              maxLength={POLL_QUESTION_MAX_LENGTH}
              multiline
              style={[
                styles.field,
                styles.fieldMultiline,
                focused === "question" ? styles.fieldFocused : null,
              ]}
            />
          </View>

          <Text style={styles.groupLabel}>Options</Text>
          {draft.options.map((option, index) => (
            <OptionRow
              // Rows move, so the key is the slot: React keeps each input
              // where it is and the moved text flows into it, which also keeps
              // the keyboard on the row the member is typing in.
              key={index}
              index={index}
              count={draft.options.length}
              value={option}
              focused={focused === index}
              disabled={posting}
              canRemove={canRemovePollOption(draft)}
              onChange={(text) =>
                edit((current) => setPollOption(current, index, text))
              }
              onFocus={() => setFocused(index)}
              onBlur={() => setFocused(null)}
              onMove={(step) =>
                edit((current) => movePollOption(current, index, step))
              }
              onRemove={() =>
                edit((current) => removePollOption(current, index))
              }
              styles={styles}
            />
          ))}

          {canAddPollOption(draft) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add option"
              accessibilityState={{ disabled: posting }}
              disabled={posting}
              onPress={() => edit(addPollOption)}
              style={styles.addRow}
            >
              <Text style={styles.addLabel}>+ Add option</Text>
            </Pressable>
          ) : (
            <Text style={styles.caption}>
              A poll can have up to {POLL_OPTIONS_MAX} options.
            </Text>
          )}

          <MoreOptionsRow
            open={showMore}
            summary={`Closes in ${closesLabel}`}
            onToggle={() => {
              Keyboard.dismiss();
              setShowMore((open) => !open);
            }}
          />

          {showMore ? (
            <View style={styles.more}>
              <Text style={styles.groupLabel}>Voting closes in</Text>
              <FilterChips
                chips={POLL_CLOSE_CHOICES.map((choice) => ({
                  value: choice.id,
                  label: choice.label,
                }))}
                selected={draft.closes}
                onSelect={(value) => {
                  if (posting) return;
                  edit((current) => ({
                    ...current,
                    closes: value as PollCloseChoice,
                  }));
                }}
                accessibilityLabel="Voting closes in"
              />
            </View>
          ) : null}

          {problem ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {problem}
            </Text>
          ) : null}

          <SheetPrimaryButton
            label={posting ? "Posting…" : "Post poll"}
            onPress={post}
            disabled={!canPost}
            busy={posting}
            accessibilityHint={
              check.ok ? undefined : "Add a question and two options."
            }
            accent={brand.accent}
            onAccent={tokens.color.gold.onHouse}
          />
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);

function OptionRow({
  index,
  count,
  value,
  focused,
  disabled,
  canRemove,
  onChange,
  onFocus,
  onBlur,
  onMove,
  onRemove,
  styles,
}: {
  index: number;
  count: number;
  value: string;
  focused: boolean;
  disabled: boolean;
  canRemove: boolean;
  onChange: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const { tokens } = useFrappTheme();
  const name = `Option ${index + 1}`;
  const glyph = tokens.color.text.mutedForeground;
  return (
    <View style={styles.optionRow}>
      <View
        style={[styles.ring, styles.optionField, focused ? styles.ringActive : null]}
      >
        <BottomSheetTextInput
          value={value}
          onChangeText={onChange}
          onFocus={onFocus}
          onBlur={onBlur}
          editable={!disabled}
          placeholder={name}
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel={name}
          maxLength={POLL_OPTION_MAX_LENGTH}
          style={[styles.field, focused ? styles.fieldFocused : null]}
        />
      </View>
      {/* Move and remove only where they do something: no Up on the first
          row, no Down on the last, no Remove below two rows. A slot keeps its
          width either way, so the fields line up down the list. */}
      <View style={styles.optionControl}>
        {index > 0 ? (
          <IconButton
            label={`Move ${name.toLowerCase()} up`}
            onPress={() => onMove(-1)}
            disabled={disabled}
          >
            <DisclosureGlyph color={glyph} direction="up" />
          </IconButton>
        ) : null}
      </View>
      <View style={styles.optionControl}>
        {index < count - 1 ? (
          <IconButton
            label={`Move ${name.toLowerCase()} down`}
            onPress={() => onMove(1)}
            disabled={disabled}
          >
            <DisclosureGlyph color={glyph} direction="down" />
          </IconButton>
        ) : null}
      </View>
      <View style={styles.optionControl}>
        {canRemove ? (
          <IconButton
            label={`Remove ${name.toLowerCase()}`}
            onPress={onRemove}
            disabled={disabled}
          >
            <CloseGlyph color={glyph} />
          </IconButton>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  const fieldStyles = sheetFieldStyles(tokens, brand.accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    ring: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    field: fieldStyles.field,
    fieldMultiline: fieldStyles.fieldMultilineText,
    fieldFocused: fieldStyles.fieldFocused,
    groupLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.xs,
    },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    optionField: {
      flex: 1,
    },
    // A 44pt slot per control: `IconButton`'s 20pt box plus its 12pt slop on
    // each side fills it exactly, so neighbouring controls' touch areas meet
    // without overlapping and each keeps the 44pt floor.
    optionControl: {
      width: tokens.touch.minimum,
      alignItems: "center",
    },
    addRow: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    addLabel: {
      ...typeRole(tokens.typography.role.label),
      color: brand.accent,
    },
    more: {
      gap: tokens.spacing.sm,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
