import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import {
  FORM_END_PASSED_PROBLEM,
  FORM_QUESTION_TYPE_CHOICES,
  addFormOption,
  addFormQuestion,
  canAddFormOption,
  canAddFormQuestion,
  canRemoveFormOption,
  canRemoveFormQuestion,
  checkFormDraft,
  emptyFormDraft,
  moveFormQuestion,
  removeFormOption,
  removeFormQuestion,
  setFormOption,
  setFormQuestion,
  type FormDraft,
} from "@repo/chat-core/form-draft";
import {
  buildFormMessage,
  isChoiceQuestion,
  type FormPayload,
  type FormQuestionType,
} from "@repo/chat-core/forms";
import { defaultSignupEnd } from "@repo/chat-core/signups";
import { localClock, localIsoDate } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import {
  FORM_DESCRIPTION_MAX_LENGTH,
  FORM_OPTION_LABEL_MAX_LENGTH,
  FORM_OPTIONS_MAX,
  FORM_QUESTION_TITLE_MAX_LENGTH,
  FORM_QUESTIONS_MAX,
  FORM_TITLE_MAX_LENGTH,
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
import { Toggle } from "@/components/toggle";
import { DueDateField } from "@/components/tasks/due-date-field";
import { DueTimeField } from "@/components/tasks/due-time-field";
import { CloseGlyph, DisclosureGlyph } from "@/components/control-glyphs";
import { successHaptic } from "@/lib/haptics";
import { InlinePicker } from "./form-controls";
import { withDay, withTime } from "./new-signup-sheet";

/**
 * The New form sheet (#3926 step 3), opened from the composer's +: a title,
 * optional details, and an ordered list of questions, each one of six types
 * and optionally required, with an optional end time. The phone's twin of
 * web's + card builder (`apps/web/components/chat/form-builder.tsx`): one
 * draft model and one card builder (`@repo/chat-core/form-draft`,
 * `buildFormMessage`), on the New sign-up sheet's chrome.
 *
 * Posting goes through the outbox like a sign-up sheet, so it survives a lost
 * connection and a server refusal lands on the card's own failed row. The
 * draft outlives a close, not a Cancel (`spec/ui/mobile/patterns.md`
 * § Bottom sheets), and the host mounts one sheet per channel.
 */
export interface NewFormSheetProps {
  /** Queues the card; `useChatChannel`'s `sendForm`. */
  onPost: (form: {
    content: string;
    payload: FormPayload;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/** Which field has focus: `title`, `details`, `<key>`, `<key>:<option key>`. */
type Focus = string | null;

export const NewFormSheet = forwardRef<BottomSheetModal, NewFormSheetProps>(
  function NewFormSheet({ onPost }, ref) {
    const { tokens } = useFrappTheme();
    const brand = useChapterBranding();
    const styles = createStyles(tokens, brand);
    const backgroundStyle = useSheetBackgroundStyle();
    const closeSheet = useSheetClose(ref);
    const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
      useSheetVisit(ref);

    const [draft, setDraft] = useState<FormDraft>(emptyFormDraft);
    const [focused, setFocused] = useState<Focus>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [posting, setPosting] = useState(false);
    const sending = useRef(false);

    const check = useMemo(() => checkFormDraft(draft), [draft]);
    const canPost = check.ok && !posting;
    const problem = failure ?? (check.ok ? null : check.problem);
    const problemQuestion =
      !failure && !check.ok ? check.questionKey : undefined;

    const edit = useCallback((next: (current: FormDraft) => FormDraft) => {
      setDraft(next);
      setFailure(null);
    }, []);

    const reset = useCallback(() => {
      setDraft(emptyFormDraft());
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
      // Checked again now: an end time can pass while the sheet sits open.
      const fresh = checkFormDraft(draft);
      if (!fresh.ok) {
        setFailure(fresh.problem ?? FORM_END_PASSED_PROBLEM);
        return;
      }
      sending.current = true;
      setPosting(true);
      setFailure(null);
      const sentFrom = visit();
      void onPost(buildFormMessage(fresh.input))
        .catch((): { ok: false; error: string } => ({
          ok: false,
          error: "Couldn't post that form. Try again.",
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
    const count = draft.questions.length;

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
            title="New form"
            onCancel={cancel}
            cancelDisabled={posting}
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
              placeholder="Title, like Formal housing"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Title"
              maxLength={FORM_TITLE_MAX_LENGTH}
              style={field("title")}
            />
          </View>

          <View style={ring("details")}>
            <BottomSheetTextInput
              value={draft.description}
              onChangeText={(description) =>
                edit((current) => ({ ...current, description }))
              }
              onFocus={() => setFocused("details")}
              onBlur={() => setFocused(null)}
              editable={!posting}
              placeholder="Details (optional)"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Details, optional"
              maxLength={FORM_DESCRIPTION_MAX_LENGTH}
              multiline
              style={field("details", true)}
            />
          </View>

          {draft.questions.map((question, index) => {
            const name = `Question ${index + 1}`;
            const invalid = problemQuestion === question.key;
            const choice = isChoiceQuestion(question.type);
            return (
              <View
                key={question.key}
                style={[styles.question, invalid ? styles.ringInvalid : null]}
              >
                <View style={styles.questionHead}>
                  <Text style={styles.groupLabel}>{name}</Text>
                  <View style={styles.questionControls}>
                    <IconButton
                      label={`Move ${name.toLowerCase()} up`}
                      onPress={() =>
                        edit((current) =>
                          moveFormQuestion(current, question.key, -1),
                        )
                      }
                      disabled={posting || index === 0}
                    >
                      <DisclosureGlyph
                        color={tokens.color.text.mutedForeground}
                        direction="up"
                      />
                    </IconButton>
                    <IconButton
                      label={`Move ${name.toLowerCase()} down`}
                      onPress={() =>
                        edit((current) =>
                          moveFormQuestion(current, question.key, 1),
                        )
                      }
                      disabled={posting || index === count - 1}
                    >
                      <DisclosureGlyph
                        color={tokens.color.text.mutedForeground}
                        direction="down"
                      />
                    </IconButton>
                    {canRemoveFormQuestion(draft) ? (
                      <IconButton
                        label={`Remove ${name.toLowerCase()}`}
                        onPress={() =>
                          edit((current) =>
                            removeFormQuestion(current, question.key),
                          )
                        }
                        disabled={posting}
                      >
                        <CloseGlyph color={tokens.color.text.mutedForeground} />
                      </IconButton>
                    ) : null}
                  </View>
                </View>

                <View style={ring(question.key, invalid)}>
                  <BottomSheetTextInput
                    value={question.title}
                    onChangeText={(title) =>
                      edit((current) =>
                        setFormQuestion(current, question.key, { title }),
                      )
                    }
                    onFocus={() => setFocused(question.key)}
                    onBlur={() => setFocused(null)}
                    editable={!posting}
                    placeholder={
                      index === 0 ? "Which room do you want?" : "Question"
                    }
                    placeholderTextColor={tokens.color.text.muted}
                    accessibilityLabel={name}
                    maxLength={FORM_QUESTION_TITLE_MAX_LENGTH}
                    style={field(question.key)}
                  />
                </View>

                <InlinePicker<FormQuestionType>
                  label={`${name} type`}
                  options={FORM_QUESTION_TYPE_CHOICES}
                  value={question.type}
                  onPick={(type) =>
                    edit((current) =>
                      setFormQuestion(current, question.key, { type }),
                    )
                  }
                  disabled={posting}
                />

                {choice
                  ? question.options.map((option, optionIndex) => {
                      const optionName = `Option ${optionIndex + 1}`;
                      const focusKey = `${question.key}:${option.key}`;
                      return (
                        <View key={option.key} style={styles.optionRow}>
                          <View style={[...ring(focusKey), styles.optionName]}>
                            <BottomSheetTextInput
                              value={option.label}
                              onChangeText={(label) =>
                                edit((current) =>
                                  setFormOption(
                                    current,
                                    question.key,
                                    option.key,
                                    label,
                                  ),
                                )
                              }
                              onFocus={() => setFocused(focusKey)}
                              onBlur={() => setFocused(null)}
                              editable={!posting}
                              placeholder={optionName}
                              placeholderTextColor={tokens.color.text.muted}
                              accessibilityLabel={`${name}, ${optionName.toLowerCase()}`}
                              maxLength={FORM_OPTION_LABEL_MAX_LENGTH}
                              style={field(focusKey)}
                            />
                          </View>
                          <View style={styles.optionControl}>
                            {canRemoveFormOption(question) ? (
                              <IconButton
                                label={`Remove ${optionName.toLowerCase()} from ${name.toLowerCase()}`}
                                onPress={() =>
                                  edit((current) =>
                                    removeFormOption(
                                      current,
                                      question.key,
                                      option.key,
                                    ),
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
                    })
                  : null}
                {choice ? (
                  canAddFormOption(question) ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Add an option to ${name.toLowerCase()}`}
                      accessibilityState={{ disabled: posting }}
                      disabled={posting}
                      onPress={() =>
                        edit((current) => addFormOption(current, question.key))
                      }
                      style={styles.addRow}
                    >
                      <Text style={styles.addLabel}>+ Add an option</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.caption}>
                      A question can have up to {FORM_OPTIONS_MAX} options.
                    </Text>
                  )
                ) : null}

                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Required</Text>
                  <Toggle
                    value={question.required}
                    accessibilityLabel={`${name} required`}
                    onValueChange={(required) => {
                      if (posting) return;
                      edit((current) =>
                        setFormQuestion(current, question.key, { required }),
                      );
                    }}
                  />
                </View>
              </View>
            );
          })}

          {canAddFormQuestion(draft) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a question"
              accessibilityState={{ disabled: posting }}
              disabled={posting}
              onPress={() => edit(addFormQuestion)}
              style={styles.addRow}
            >
              <Text style={styles.addLabel}>+ Add a question</Text>
            </Pressable>
          ) : (
            <Text style={styles.caption}>
              A form can have up to {FORM_QUESTIONS_MAX} questions.
            </Text>
          )}

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Closes at a set time</Text>
            <Toggle
              value={draft.closesAt !== null}
              accessibilityLabel="Closes at a set time"
              onValueChange={(on) => {
                if (posting) return;
                edit((current) => ({
                  ...current,
                  closesAt: on ? defaultSignupEnd(new Date()) : null,
                }));
              }}
            />
          </View>
          {draft.closesAt ? (
            <View style={styles.endRow}>
              <DueDateField
                value={localIsoDate(draft.closesAt)}
                today={localIsoDate(new Date())}
                disabled={posting}
                onChange={(day) =>
                  edit((current) => ({
                    ...current,
                    closesAt: withDay(current.closesAt, day),
                  }))
                }
              />
              <DueTimeField
                value={localClock(draft.closesAt)}
                suggested="18:00"
                disabled={posting}
                onChange={(time) =>
                  edit((current) => ({
                    ...current,
                    // Clearing the time takes the end time off.
                    closesAt:
                      time === null ? null : withTime(current.closesAt, time),
                  }))
                }
              />
            </View>
          ) : null}

          {problem ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {problem}
            </Text>
          ) : null}

          <SheetPrimaryButton
            label={posting ? "Posting…" : "Post form"}
            onPress={post}
            disabled={!canPost}
            busy={posting}
            accessibilityHint={
              check.ok ? undefined : "Add a title and write one question."
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
    question: {
      gap: tokens.spacing.sm,
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      marginTop: tokens.spacing.xs,
    },
    questionHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    questionControls: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.lg,
    },
    groupLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    optionName: {
      flex: 1,
    },
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
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    toggleLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    endRow: {
      gap: tokens.spacing.sm,
    },
  });
}
