import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  FORM_NO,
  FORM_YES,
  formAnswerProblems,
  formAnswersForSave,
  formDeadlineLine,
  formPageNotice,
  formProblemCountLine,
  formResponseKey,
  isFormClosed,
  readFormPayload,
  saveFormResponse,
  type FormAnswers,
  type FormPayload,
  type FormQuestion,
} from "@repo/chat-core/forms";
import type { ChatMessage } from "@repo/chat-core/types";
import { useFrappClient, useNow } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  FORM_PARAGRAPH_ANSWER_MAX_LENGTH,
  FORM_SHORT_ANSWER_MAX_LENGTH,
} from "@repo/validation";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import { useFocusEffect } from "expo-router";
import { useHoldSwipeBack } from "@/lib/back-target";
import { useBackToClose, useFocusOnOpen } from "@/lib/overlay";
import { KeyboardAvoidingArea } from "@/lib/keyboard";
import { successHaptic } from "@/lib/haptics";
import { useOwnFormResponse } from "@/lib/chat/use-own-form-response";
import { IconButton } from "@/components/icon-button";
import { CloseGlyph } from "@/components/control-glyphs";
import {
  SheetPrimaryButton,
  sheetFieldStyles,
} from "@/components/sheet-scaffold";
import {
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { InlinePicker, PickRow } from "./form-controls";

/**
 * The full-page form a form card opens (#3926 step 3), the phone's twin of
 * web's `FormFillDialog` (`apps/web/components/chat/form-fill-dialog.tsx`):
 * every question in order, the viewer's own answers, and Send. One scrolling
 * page, as Google Forms and Microsoft Forms draw one on a phone, over the
 * chat it was opened from, as Slack opens a workflow form over the
 * conversation, so Close lands the member back where they were.
 *
 * Answers are private (`@repo/chat-core/forms`): read and saved through the
 * form-response route, never the card, and changeable until the form
 * closes. A closed form shows only the answers that were sent.
 *
 * An overlay in the thread's own view tree, not a `Modal`, for the reason
 * every overlay is (`spec/ui/mobile/patterns.md` § Overlays). The screen
 * owns its state ({@link useFormFill}) and hands the page the card's live
 * row on every render, so a Close form or an edit that reaches the thread
 * reaches the open page too; the screen closes it when the row is deleted or
 * stops being drawn. The rows reach it through {@link FormFillContext}, not
 * a prop threaded down the row.
 */

export interface FormFillState {
  /** The open form's message id, or `null`. */
  messageId: string | null;
  /** Counts opens, so each starts clean and a late save can't reach the next. */
  session: number;
  open: (messageId: string) => void;
  close: () => void;
}

/**
 * Opens the form page on a form card. `null` outside a screen that hosts the
 * page, where the card's button stays disabled.
 */
export const FormFillContext = createContext<FormFillState["open"] | null>(
  null,
);

export function useOpenForm(): FormFillState["open"] | null {
  return useContext(FormFillContext);
}

/**
 * The page's state, for the screen that hosts it. Android's back closes it
 * and the iOS edge swipe holds while it is up, so neither pops the thread
 * from under a half-answered form.
 */
export function useFormFill(): FormFillState {
  const [target, setTarget] = useState<{
    messageId: string;
    session: number;
  } | null>(null);
  const sessions = useRef(0);
  const open = useCallback((messageId: string) => {
    Keyboard.dismiss();
    sessions.current += 1;
    setTarget({ messageId, session: sessions.current });
  }, []);
  const close = useCallback(() => {
    Keyboard.dismiss();
    setTarget(null);
  }, []);
  useBackToClose(target !== null, close);
  useHoldSwipeBack(target !== null);
  return {
    messageId: target?.messageId ?? null,
    session: target?.session ?? 0,
    open,
    close,
  };
}

/**
 * Whether the open form's row can still be answered or read: on screen, not
 * deleted, and a form the phone can draw. The host closes the page when it
 * isn't.
 */
export function formFillLive(message: ChatMessage | null | undefined): boolean {
  return (
    !!message &&
    message.kind === "form" &&
    !message.is_deleted &&
    readFormPayload(message) !== null
  );
}

/** A row the host draws, as `applyBlockList` hands them out. */
interface HostRow {
  message: ChatMessage;
  visibility: string;
}

/**
 * Everything a screen needs to host the page, shared by the channel and a
 * message thread so the two can't drift: the state, the card's live row, and
 * the closes. It closes the page
 *
 * - when the screen loses focus or `scope` (the channel) changes, so a page
 *   left under a pushed screen can't take that screen's back press;
 * - when the card is deleted, stops being drawn in full (tombstoned or held
 *   by the block list), or no longer reads as a form.
 *
 * A card that only left the loaded rows (a reconnect backfill that came back
 * full trims every older row) still exists, so the page keeps the last copy
 * it saw rather than throwing away what the member typed.
 */
export function useFormFillHost(
  rows: readonly HostRow[],
  scope: string | null | undefined,
): { state: FormFillState; message: ChatMessage | undefined } {
  const state = useFormFill();
  const { messageId, close } = state;
  useFocusEffect(
    useCallback(() => {
      // No channel, no card to have opened a page from.
      if (!scope) return;
      return () => close();
    }, [scope, close]),
  );
  const [lastSeen, setLastSeen] = useState<ChatMessage | null>(null);
  let message: ChatMessage | undefined;
  let gone = false;
  if (messageId) {
    const found = rows.find((row) => row.message.id === messageId);
    if (found) {
      if (found.visibility === "visible" && formFillLive(found.message)) {
        message = found.message;
      } else {
        gone = true;
      }
    } else if (lastSeen?.id === messageId) {
      message = lastSeen;
    } else {
      gone = true;
    }
  }
  // Reset during render, as the image viewer does, so no frame draws a form
  // the thread no longer shows.
  if (gone) close();
  if (message && message !== lastSeen) setLastSeen(message);
  return { state, message };
}

export function FormFillPage({
  state,
  message,
}: {
  state: FormFillState;
  /** The open form's live row, looked up by the host on every render. */
  message: ChatMessage | null | undefined;
}) {
  const payload = useMemo(
    () => (message && formFillLive(message) ? readFormPayload(message) : null),
    [message],
  );
  if (!state.messageId || !message || !payload) return null;
  return (
    <FormFillBody
      // A close unmounts everything an open started, and the next open (even
      // of the same form) starts clean.
      key={state.session}
      messageId={message.id}
      payload={payload}
      onDone={state.close}
    />
  );
}

function FormFillBody({
  messageId,
  payload,
  onDone,
}: {
  messageId: string;
  payload: FormPayload;
  onDone: () => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = useMemo(() => createStyles(tokens, brand), [tokens, brand]);
  const apiClient = useFrappClient();
  const queryClient = useQueryClient();
  const now = useNow();
  const closed = isFormClosed(payload, now);
  const deadline = formDeadlineLine(payload, now);

  const response = useOwnFormResponse(messageId, true);
  // Read again on open: the card's copy can be a minute old, and answers
  // sent from web since must not be overwritten by a stale prefill. Until
  // that read settles the questions are drawn but not editable, so the first
  // edit is made on the newest answers; if it fails, they become editable on
  // the copy there is (a send then reaches the server, which has the say).
  const { refetch } = response;
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    let live = true;
    void refetch().finally(() => {
      if (live) setSynced(true);
    });
    return () => {
      live = false;
    };
  }, [refetch]);
  const saved = response.data?.answers;
  // Loaded at least once (`null` is "not answered yet"). A failed background
  // refetch keeps the questions and the member's edits on screen rather than
  // swapping them for an error mid-edit.
  const loaded = response.data !== undefined;
  const answered = !!response.data;

  // The member's edits, or `null` before their first: until then the page
  // shows the answers they last sent.
  const [edited, setEdited] = useState<FormAnswers | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A closed form shows what was sent, never edits that didn't go out.
  const current = useMemo(
    () => (closed ? (saved ?? {}) : (edited ?? saved ?? {})),
    [closed, edited, saved],
  );
  const problems = useMemo(
    () => formAnswerProblems(payload.questions, current),
    [payload.questions, current],
  );
  const problemCount = Object.keys(problems).length;

  const setAnswer = useCallback(
    (questionId: string, value: string | string[] | undefined) => {
      setFailure(null);
      setEdited((prev) => {
        const next = { ...(prev ?? saved ?? {}) };
        if (value === undefined) delete next[questionId];
        else next[questionId] = value;
        return next;
      });
    },
    [saved],
  );

  // A save that lands after this page closed (or another form opened in its
  // place) must not close whatever is open by then: this body is keyed by
  // the open, so it has unmounted.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const send = async () => {
    if (closed || sending || !loaded || !synced) return;
    if (problemCount > 0) {
      setShowProblems(true);
      return;
    }
    Keyboard.dismiss();
    setSending(true);
    setFailure(null);
    try {
      const next = await saveFormResponse(
        apiClient,
        messageId,
        formAnswersForSave(payload.questions, current),
      );
      if (!mounted.current) {
        // The page closed while the save was in flight, maybe for a sign-out:
        // writing these answers into the cache could hand them to whoever is
        // signed in now, so the card reads its own again instead.
        void queryClient.invalidateQueries({
          queryKey: formResponseKey(messageId),
        });
        return;
      }
      queryClient.setQueryData(formResponseKey(messageId), next);
      successHaptic();
      onDone();
    } catch (cause) {
      if (!mounted.current) return;
      setFailure(
        cause instanceof Error ? cause.message : "Couldn't send your answers",
      );
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  const heading = useRef<View>(null);
  useFocusOnOpen(heading, true);

  const notice = formPageNotice(closed, loaded, answered);

  return (
    <View accessibilityViewIsModal style={styles.fill}>
      <SafeAreaView
        style={styles.safe}
        edges={["top", "left", "right", "bottom"]}
      >
        <KeyboardAvoidingArea style={styles.safe} atScreenBottom>
          <View style={styles.header}>
            <View
              ref={heading}
              accessible
              accessibilityRole="header"
              style={styles.headerText}
            >
              <Text style={styles.eyebrow}>
                Form{deadline ? ` · ${deadline}` : ""}
              </Text>
            </View>
            <IconButton label="Close form page" onPress={onDone}>
              <CloseGlyph color={tokens.color.text.foreground} />
            </IconButton>
          </View>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>{payload.title}</Text>
            {payload.description ? (
              <Text style={styles.description}>{payload.description}</Text>
            ) : null}
            <Text style={styles.notice}>{notice}</Text>

            {response.isPending ? (
              // The questions' own shape, a title over its control, so the
              // page doesn't jump when the answers land (components.md §10).
              <SkeletonRegion
                label="Loading your answers"
                style={styles.questions}
              >
                {payload.questions.map((question) => (
                  <View key={question.id} style={styles.question}>
                    <SkeletonText
                      role={tokens.typography.role.body}
                      width="60%"
                    />
                    <SkeletonBlock
                      width="100%"
                      height={tokens.touch.minimum}
                      radius={tokens.radius.control}
                    />
                  </View>
                ))}
              </SkeletonRegion>
            ) : !loaded ? (
              <View style={styles.loading}>
                <Text accessibilityRole="alert" style={styles.error}>
                  {response.error?.message ?? "Couldn't load your answers"}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                  onPress={() => void response.refetch()}
                  style={styles.linkButton}
                >
                  <Text style={styles.linkText}>Try again</Text>
                </Pressable>
              </View>
            ) : (
              payload.questions.map((question, index) => (
                <QuestionField
                  key={question.id}
                  index={index}
                  question={question}
                  value={current[question.id]}
                  onChange={(value) => setAnswer(question.id, value)}
                  readOnly={closed || sending || !synced}
                  problem={showProblems ? problems[question.id] : undefined}
                />
              ))
            )}
          </ScrollView>
          <View style={styles.footer}>
            {failure ? (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {failure}
              </Text>
            ) : showProblems && problemCount > 0 ? (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {formProblemCountLine(problemCount)}
              </Text>
            ) : null}
            {closed ? (
              <SheetPrimaryButton
                label="Done"
                onPress={onDone}
                accent={brand.accent}
                onAccent={tokens.color.gold.onHouse}
              />
            ) : (
              <SheetPrimaryButton
                label={
                  sending ? "Sending…" : answered ? "Update answers" : "Send"
                }
                onPress={() => void send()}
                disabled={sending || !loaded || !synced}
                busy={sending}
                accent={brand.accent}
                onAccent={tokens.color.gold.onHouse}
              />
            )}
          </View>
        </KeyboardAvoidingArea>
      </SafeAreaView>
    </View>
  );
}

function QuestionField({
  index,
  question,
  value,
  onChange,
  readOnly,
  problem,
}: {
  index: number;
  question: FormQuestion;
  value: string | string[] | undefined;
  onChange: (value: string | string[] | undefined) => void;
  readOnly: boolean;
  problem: string | undefined;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = useMemo(() => createStyles(tokens, brand), [tokens, brand]);
  const [focused, setFocused] = useState(false);
  const text = typeof value === "string" ? value : "";
  const picked = Array.isArray(value) ? value : [];
  const spokenTitle = `Question ${index + 1}: ${question.title}${
    question.required ? " (required)" : ""
  }`;

  let control: ReactNode;
  switch (question.type) {
    case "short_answer":
    case "paragraph": {
      const paragraph = question.type === "paragraph";
      control = (
        <View
          style={[
            styles.ring,
            focused ? styles.ringActive : null,
            problem ? styles.ringInvalid : null,
          ]}
        >
          <TextInput
            value={text}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            editable={!readOnly}
            placeholder={readOnly ? undefined : "Your answer"}
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel={spokenTitle}
            maxLength={
              paragraph
                ? FORM_PARAGRAPH_ANSWER_MAX_LENGTH
                : FORM_SHORT_ANSWER_MAX_LENGTH
            }
            multiline={paragraph}
            style={[
              styles.field,
              paragraph ? styles.fieldMultiline : null,
              focused ? styles.fieldFocused : null,
            ]}
          />
        </View>
      );
      break;
    }
    case "dropdown":
      control = (
        <InlinePicker
          label={spokenTitle}
          options={question.options ?? []}
          value={text || null}
          onPick={(id) => onChange(id)}
          disabled={readOnly}
          invalid={!!problem}
        />
      );
      break;
    case "multiple_choice":
    case "yes_no":
    case "checkboxes": {
      const options =
        question.type === "yes_no"
          ? [
              { id: FORM_YES, label: "Yes" },
              { id: FORM_NO, label: "No" },
            ]
          : (question.options ?? []);
      const many = question.type === "checkboxes";
      control = (
        <View
          accessibilityRole={many ? undefined : "radiogroup"}
          accessibilityLabel={spokenTitle}
        >
          {options.map((option) => {
            const checked = many
              ? picked.includes(option.id)
              : text === option.id;
            return (
              <PickRow
                key={option.id}
                label={option.label}
                selected={checked}
                many={many}
                disabled={readOnly}
                onPress={() => {
                  if (!many) {
                    onChange(option.id);
                    return;
                  }
                  const next = checked
                    ? picked.filter((each) => each !== option.id)
                    : [...picked, option.id];
                  onChange(next.length > 0 ? next : undefined);
                }}
              />
            );
          })}
          {!many && !readOnly && text && !question.required ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Clear selection, question ${index + 1}`}
              hitSlop={8}
              onPress={() => onChange(undefined)}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>Clear selection</Text>
            </Pressable>
          ) : null}
        </View>
      );
      break;
    }
  }

  return (
    <View style={styles.question}>
      <Text style={styles.questionTitle} accessibilityLabel={spokenTitle}>
        {question.title}
        {question.required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {control}
      {problem ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  const fieldStyles = sheetFieldStyles(tokens, brand.accent);
  return StyleSheet.create({
    fill: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: tokens.color.surface.background,
    },
    safe: {
      flex: 1,
    },
    flex: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      minHeight: tokens.touch.minimum,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    headerText: {
      flexShrink: 1,
    },
    eyebrow: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.lg,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    description: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      marginTop: -tokens.spacing.sm,
    },
    notice: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    loading: {
      gap: tokens.spacing.sm,
      alignItems: "flex-start",
    },
    questions: {
      gap: tokens.spacing.lg,
    },
    question: {
      gap: tokens.spacing.sm,
    },
    questionTitle: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.foreground,
    },
    required: {
      color: tokens.color.semantic.destructive,
    },
    ring: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    ringInvalid: {
      borderColor: tokens.color.semantic.destructive,
    },
    field: fieldStyles.field,
    fieldMultiline: {
      ...fieldStyles.fieldMultilineText,
      minHeight: 96,
    },
    fieldFocused: fieldStyles.fieldFocused,
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    linkButton: {
      alignSelf: "flex-start",
      paddingVertical: tokens.spacing.xs,
    },
    linkText: {
      ...typeRole(tokens.typography.role.caption),
      color: brand.accent,
    },
    footer: {
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
  });
}
