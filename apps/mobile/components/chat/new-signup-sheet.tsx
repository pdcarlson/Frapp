import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import {
  addSignupSlot,
  buildSignupMessage,
  canAddSignupSlot,
  canRemoveSignupSlot,
  checkSignupDraft,
  SIGNUP_END_PASSED_PROBLEM,
  emptySignupDraft,
  SIGNUP_FORMAT_CHOICES,
  removeSignupSlot,
  setSignupSlot,
  type SignupDraft,
  type SignupDraftFormat,
  type SignupPayload,
} from "@repo/chat-core/signups";
import { SignetTokens } from "@repo/theme/signet";
import {
  SIGNUP_NOTE_MAX_LENGTH,
  SIGNUP_SLOT_LABEL_MAX_LENGTH,
  SIGNUP_SLOTS_MAX,
  SIGNUP_TITLE_MAX_LENGTH,
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
  SHEET_STACK_BEHAVIOR,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { IconButton } from "@/components/icon-button";
import { Segmented } from "@/components/segmented";
import { CloseGlyph } from "@/components/control-glyphs";
import { successHaptic } from "@/lib/haptics";
import { EndTimeField } from "./end-time-field";

/**
 * The New sign-up sheet (#3926), opened from the composer's +: a title,
 * optional details, and either up to twenty slots, each a name and how many
 * spots it has (blank is no limit), or a headcount (Going / Can't make it,
 * step 2). Either may end at a set time, picked with the New task sheet's
 * platform date and time fields. The phone's twin of web's + card form
 * (`apps/web/components/chat/signup-form.tsx`): one draft model and one card
 * builder (`@repo/chat-core/signups`), on the New poll sheet's chrome.
 *
 * Posting goes through the outbox like a poll, so it survives a lost
 * connection and a server refusal lands on the card's own failed row. The
 * draft outlives a close, not a Cancel (`spec/ui/mobile/patterns.md`
 * § Bottom sheets), and the host mounts one sheet per channel.
 */
export interface NewSignupSheetProps {
  /** Queues the card; `useChatChannel`'s `sendSignup`. */
  onPost: (signup: {
    content: string;
    payload: SignupPayload;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/** The title, the details, a slot field by `<key>:label` / `<key>:spots`, or nothing. */
type Focus = string | null;

export const NewSignupSheet = forwardRef<BottomSheetModal, NewSignupSheetProps>(
  function NewSignupSheet({ onPost }, ref) {
    const { tokens } = useFrappTheme();
    const brand = useChapterBranding();
    const styles = createStyles(tokens, brand);
    const backgroundStyle = useSheetBackgroundStyle();
    const closeSheet = useSheetClose(ref);
    const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
      useSheetVisit(ref);

    const [draft, setDraft] = useState<SignupDraft>(emptySignupDraft);
    const [focused, setFocused] = useState<Focus>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [posting, setPosting] = useState(false);
    const sending = useRef(false);

    const check = useMemo(() => checkSignupDraft(draft), [draft]);
    const canPost = check.ok && !posting;
    const problem = failure ?? (check.ok ? null : check.problem);
    const problemRow = !failure && !check.ok ? check.slotKey : undefined;

    const edit = useCallback((next: (current: SignupDraft) => SignupDraft) => {
      setDraft(next);
      setFailure(null);
    }, []);

    const reset = useCallback(() => {
      setDraft(emptySignupDraft());
      setFocused(null);
      setFailure(null);
    }, []);

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
      // Checked again now, not at the last edit: an end time can pass while the
      // form sits open, and the server keeps a past one, so the card would post
      // already closed.
      const fresh = checkSignupDraft(draft);
      if (!fresh.ok) {
        setFailure(fresh.problem ?? SIGNUP_END_PASSED_PROBLEM);
        return;
      }
      sending.current = true;
      setPosting(true);
      setFailure(null);
      const sentFrom = visit();
      void onPost(buildSignupMessage(fresh.input))
        .catch((): { ok: false; error: string } => ({
          ok: false,
          error: "Couldn't post that sign-up sheet. Try again.",
        }))
        .then((result) => {
          sending.current = false;
          setPosting(false);
          if (result.ok) {
            successHaptic();
            reset();
            if (isSameVisit(sentFrom)) dismiss();
            return;
          }
          if (isSameVisit(sentFrom)) setFailure(result.error);
        });
    }, [check, draft, onPost, reset, dismiss, visit, isSameVisit]);

    const field = (key: string, multiline = false) => [
      styles.field,
      multiline ? styles.fieldMultiline : null,
      focused === key ? styles.fieldFocused : null,
    ];
    const ring = (key: string, invalid = false) => [
      styles.ring,
      focused === key ? styles.ringActive : null,
      invalid ? styles.ringInvalid : null,
    ];

    return (
      <BottomSheetModal
        ref={ref}
        stackBehavior={SHEET_STACK_BEHAVIOR}
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
            title="New sign-up sheet"
            onCancel={cancel}
            cancelDisabled={posting}
          />

          <Segmented<SignupDraftFormat>
            options={SIGNUP_FORMAT_CHOICES.map((choice) => ({
              value: choice.id,
              label: choice.label,
            }))}
            value={draft.format}
            onChange={(format) => edit((current) => ({ ...current, format }))}
            accessibilityLabel="Kind of sign-up"
            disabled={posting}
          />

          <View style={ring("title")}>
            <BottomSheetTextInput
              value={draft.title}
              onChangeText={(title) =>
                edit((current) => ({ ...current, title }))
              }
              onFocus={() => setFocused("title")}
              onBlur={() => setFocused(null)}
              editable={!posting}
              placeholder={
                draft.format === "headcount"
                  ? "Title, like Formal on Saturday"
                  : "Title, like Sober drivers this weekend"
              }
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Title"
              maxLength={SIGNUP_TITLE_MAX_LENGTH}
              style={field("title")}
            />
          </View>

          <View style={ring("note")}>
            <BottomSheetTextInput
              value={draft.note}
              onChangeText={(note) => edit((current) => ({ ...current, note }))}
              onFocus={() => setFocused("note")}
              onBlur={() => setFocused(null)}
              editable={!posting}
              placeholder="Details (optional)"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Details, optional"
              maxLength={SIGNUP_NOTE_MAX_LENGTH}
              multiline
              style={field("note", true)}
            />
          </View>

          {draft.format === "headcount" ? (
            <Text style={styles.caption}>
              Members answer Going or Can’t make it, and can add a short note.
            </Text>
          ) : (
            <>
              <Text style={styles.groupLabel}>Slots</Text>
              <Text style={styles.caption}>
                Leave Spots blank for no limit.
              </Text>
              {draft.slots.map((slot, index) => {
                const name = `Slot ${index + 1}`;
                const invalid = problemRow === slot.key;
                return (
                  <View key={slot.key} style={styles.slotRow}>
                    <View
                      style={[
                        ...ring(`${slot.key}:label`, invalid),
                        styles.slotName,
                      ]}
                    >
                      <BottomSheetTextInput
                        value={slot.label}
                        onChangeText={(label) =>
                          edit((current) =>
                            setSignupSlot(current, slot.key, { label }),
                          )
                        }
                        onFocus={() => setFocused(`${slot.key}:label`)}
                        onBlur={() => setFocused(null)}
                        editable={!posting}
                        placeholder={index === 0 ? "Friday" : name}
                        placeholderTextColor={tokens.color.text.muted}
                        accessibilityLabel={`${name} name`}
                        maxLength={SIGNUP_SLOT_LABEL_MAX_LENGTH}
                        style={field(`${slot.key}:label`)}
                      />
                    </View>
                    <View
                      style={[
                        ...ring(`${slot.key}:spots`, invalid),
                        styles.slotSpots,
                      ]}
                    >
                      <BottomSheetTextInput
                        value={slot.capacity}
                        onChangeText={(capacity) =>
                          edit((current) =>
                            setSignupSlot(current, slot.key, { capacity }),
                          )
                        }
                        onFocus={() => setFocused(`${slot.key}:spots`)}
                        onBlur={() => setFocused(null)}
                        editable={!posting}
                        placeholder="Spots"
                        placeholderTextColor={tokens.color.text.muted}
                        accessibilityLabel={`${name} spots`}
                        keyboardType="number-pad"
                        maxLength={3}
                        style={[
                          ...field(`${slot.key}:spots`),
                          styles.spotsText,
                        ]}
                      />
                    </View>
                    <View style={styles.slotControl}>
                      {canRemoveSignupSlot(draft) ? (
                        <IconButton
                          label={`Remove ${name.toLowerCase()}`}
                          onPress={() =>
                            edit((current) =>
                              removeSignupSlot(current, slot.key),
                            )
                          }
                          disabled={posting}
                        >
                          <CloseGlyph
                            color={tokens.color.text.mutedForeground}
                          />
                        </IconButton>
                      ) : null}
                    </View>
                  </View>
                );
              })}

              {canAddSignupSlot(draft) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add a slot"
                  accessibilityState={{ disabled: posting }}
                  disabled={posting}
                  onPress={() => edit(addSignupSlot)}
                  style={styles.addRow}
                >
                  <Text style={styles.addLabel}>+ Add a slot</Text>
                </Pressable>
              ) : (
                <Text style={styles.caption}>
                  A sign-up sheet can have up to {SIGNUP_SLOTS_MAX} slots.
                </Text>
              )}
            </>
          )}

          <EndTimeField
            label="Ends at a set time"
            value={draft.closesAt}
            disabled={posting}
            onChange={(closesAt) =>
              edit((current) => ({ ...current, closesAt }))
            }
          />

          {problem ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {problem}
            </Text>
          ) : null}

          <SheetPrimaryButton
            label={posting ? "Posting…" : "Post sign-up"}
            onPress={post}
            disabled={!canPost}
            busy={posting}
            accessibilityHint={
              check.ok
                ? undefined
                : draft.format === "headcount"
                  ? "Add a title."
                  : "Add a title and name at least one slot."
            }
            accent={brand.accent}
            onAccent={tokens.color.gold.onHouse}
          />
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);

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
    ringInvalid: {
      borderColor: tokens.color.semantic.destructive,
    },
    field: fieldStyles.field,
    fieldMultiline: fieldStyles.fieldMultilineText,
    fieldFocused: fieldStyles.fieldFocused,
    groupLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.xs,
    },
    slotRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    slotName: {
      flex: 1,
    },
    slotSpots: {
      width: 76,
    },
    spotsText: {
      textAlign: "center",
    },
    slotControl: {
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
