import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import Svg, { Path } from "react-native-svg";
import {
  useAsk,
  useAskStatus,
  useDocumentDownloadUrl,
  type AskExchange,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  ASK_COPY,
  ASK_QUESTION_MAX_LENGTH,
  askSavedLine,
  formatAiAnswerDate,
  type AskAnswer,
  type AskSource,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/ai-consent-sheet";
import { AskExchangeCard } from "@/components/ask/answer-card";
import {
  SheetGrabber,
  SheetScrim,
  useSheetBackgroundStyle,
  SheetBackToClose,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { askSourceOpening } from "@/lib/ask/source-route";
import { asRoute, openHref } from "@/lib/href";
import { selectDownloadUrl } from "@/lib/more/documents";
import { notificationHref } from "@/lib/notifications/targets";
import {
  fieldTypeRole,
  fontFamilyFor,
  typeRole,
  useFrappTheme,
} from "@/lib/theme";

/**
 * Ask Frapp on the phone (`spec/ui/mobile/screens.md` s17;
 * `spec/behavior/ai.md` § Ask; #450, #451): one question, answered from the
 * chapter's own documents, minutes and records, each claim marked with the
 * source it came from. It talks to the same route web's panel does
 * (`useAsk`), in the same words (`ASK_COPY`).
 *
 * A member asks walking to class, so the whole exchange is one sheet over
 * wherever they are, opened from the tab bar's + (`quick-actions-panel.tsx`).
 * ChatGPT's and Perplexity's phone apps put the field at the bottom above the
 * keyboard and the answer above it; so does this.
 *
 * **One question at a time.** Ask answers each question on its own and keeps
 * no conversation, so the sheet shows one exchange and says so under the
 * field, not a thread that would promise it remembers.
 *
 * **Consent is asked at the first question**, not when the sheet opens
 * (`useAiConsentGate`; `ai.md` § Consent). The server checks again.
 *
 * **The saved line.** While the beta diagnostics window is on for this
 * chapter, the line under the field says questions and answers are saved and
 * until when, and only then does a question carry `saved_notice_shown`: the
 * server keeps nothing from a client that did not show it. The line's box is
 * two lines high whichever words it holds, so its arrival never moves the
 * field.
 *
 * **A source opens the real thing.** A document opens in the in-app browser
 * over the sheet, so the answer is still there when it closes. Anything else
 * is a screen: the sheet closes and the screen opens, and the answer is back
 * when the sheet is reopened.
 *
 * **Fixed gold, never the chapter accent** (`components.md` §11): nothing in
 * this file or in `answer-card.tsx` reaches `useChapterBranding()`.
 *
 * ## Why fixed snap points rather than dynamic sizing
 *
 * The body grows as an answer streams in, and dynamic sizing would resize the
 * sheet with every line. The drawing caps at 78% (`patterns.md`), so that is
 * the one detent; the body scrolls, and the composer is the scrollable's
 * sibling so it stays pinned above the keyboard. `BottomSheetScrollView` is a
 * direct child of the sheet for the reason `new-task-sheet.tsx` gives.
 *
 * Whether a member has Ask at all is the host's question (`useAiSurfaces`):
 * with the server's AI off, nothing mounts this.
 */

const ASK_SNAP_POINTS = ["78%"];

/** An answer this client gives without asking the server. */
function heldExchange(
  question: string,
  end:
    | { failure: string }
    | { reason: "consent_required" },
): AskExchange {
  if ("failure" in end) {
    return {
      question,
      phase: "failed",
      step: null,
      preview: "",
      answer: null,
      failure: { message: end.failure, retryable: true },
    };
  }
  const answer: AskAnswer = {
    status: "unavailable",
    reason: end.reason,
    text: "",
    citations: [],
    sources: [],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
    saved: false,
  };
  return {
    question,
    phase: "done",
    step: null,
    preview: "",
    answer,
    failure: null,
  };
}

export const AskSheet = forwardRef<
  BottomSheetModal,
  {
    /** The sheet closed, however it closed. */
    onClosed?: () => void;
  }
>(function AskSheet({ onClosed }, ref) {
  const closeSheet = useSheetClose(ref);
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();

  const { exchange, ask, reset } = useAsk();
  const [shownOpen, setShownOpen] = useState(false);
  const status = useAskStatus({ enabled: shownOpen });
  const { ensureConsent, consentSheet } = useAiConsentGate();
  const openDocument = useDocumentDownloadUrl();

  const [draft, setDraft] = useState("");
  // A question that never reached the server: the member has not said yes,
  // or their answer couldn't be read.
  const [held, setHeld] = useState<AskExchange | null>(null);
  const [openingSourceId, setOpeningSourceId] = useState<string | null>(null);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const presenting = useRef(false);

  const savedUntil = status.data?.saved_until ?? null;
  const shown = held ?? exchange;
  const working = shown?.phase === "working";

  // A question still being answered is dropped with the sheet; a finished
  // answer is there when it reopens.
  const workingRef = useRef(working);
  useEffect(() => {
    workingRef.current = working;
  }, [working]);
  const onDismiss = useCallback(() => {
    setShownOpen(false);
    if (workingRef.current) reset();
    onClosed?.();
  }, [onClosed, reset]);

  const submit = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || workingRef.current) return;
      setDraft("");
      setHeld(null);
      setSourceNotice(null);
      let agreed: boolean;
      try {
        agreed = await ensureConsent();
      } catch (error) {
        setHeld(
          heldExchange(question, {
            failure: errorCopy(error, ASK_COPY.failed),
          }),
        );
        return;
      }
      if (!agreed) {
        setHeld(heldExchange(question, { reason: "consent_required" }));
        return;
      }
      await ask(question, { savedNoticeShown: savedUntil !== null });
    },
    [ask, ensureConsent, savedUntil],
  );

  const canOpen = useCallback(
    (source: AskSource) => askSourceOpening(source) !== null,
    [],
  );

  const openSource = useCallback(
    async (source: AskSource) => {
      const opening = askSourceOpening(source);
      if (!opening) return;
      if (opening.kind === "route") {
        closeSheet();
        openHref(router, asRoute(notificationHref(opening.target)));
        return;
      }
      // One browser at a time: iOS rejects a second presentation.
      if (presenting.current) return;
      presenting.current = true;
      setSourceNotice(null);
      setOpeningSourceId(source.id);
      try {
        const url = selectDownloadUrl(
          await openDocument.mutateAsync(opening.documentId),
        );
        if (!url) {
          setSourceNotice(SOURCE_OPEN_FAILED);
          return;
        }
        await WebBrowser.openBrowserAsync(url);
      } catch {
        setSourceNotice(SOURCE_OPEN_FAILED);
      } finally {
        presenting.current = false;
        setOpeningSourceId(null);
      }
    },
    [closeSheet, openDocument, router],
  );

  const canSend = draft.trim().length > 0 && !working;

  return (
    <>
      <BottomSheetModal
        ref={ref}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        // Required: with dynamic sizing on (gorhom v5's default) the sheet
        // opens at its content height, a header and three rows, and the
        // composer lays out below the screen edge.
        enableDynamicSizing={false}
        snapPoints={ASK_SNAP_POINTS}
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onAnimate={(_from, to) => {
          if (to >= 0) setShownOpen(true);
        }}
        onDismiss={onDismiss}
      >
        <SheetBackToClose onClose={closeSheet} />
        <BottomSheetScrollView
          onAccessibilityEscape={closeSheet}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text accessibilityRole="header" style={styles.headerTitle}>
            {ASK_COPY.name}
          </Text>

          {shown ? (
            <>
              <View style={styles.echo}>
                <Text style={styles.echoText}>{shown.question}</Text>
              </View>
              <AskExchangeCard
                exchange={shown}
                canOpen={canOpen}
                openingSourceId={openingSourceId}
                onOpenSource={(source) => void openSource(source)}
                onRetry={() => void submit(shown.question)}
                onAnswerConsent={() => void submit(shown.question)}
              />
              {sourceNotice !== null ? (
                <Text accessibilityLiveRegion="polite" style={styles.caption}>
                  {sourceNotice}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.emptyBody}>{ASK_COPY.empty_body}</Text>
              <View style={styles.examples}>
                {ASK_COPY.examples.map((example) => (
                  <Pressable
                    key={example}
                    accessibilityRole="button"
                    accessibilityLabel={example}
                    accessibilityHint="Asks this question."
                    onPress={() => void submit(example)}
                    style={({ pressed }) => [
                      styles.example,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.exampleText}>{example}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </BottomSheetScrollView>

        <View style={styles.composer}>
          <View style={styles.composerRow}>
            {/* `BottomSheetTextInput`, never a plain `TextInput`
                (`patterns.md` § Bottom sheets). */}
            <BottomSheetTextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => void submit(draft)}
              maxLength={ASK_QUESTION_MAX_LENGTH}
              placeholder={ASK_COPY.placeholder}
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel={ASK_COPY.placeholder}
              returnKeyType="send"
              style={styles.composerField}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={ASK_COPY.send}
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              // 40pt drawn against the 44pt minimum.
              hitSlop={2}
              onPress={() => void submit(draft)}
              style={({ pressed }) => [
                styles.send,
                !canSend ? styles.sendDisabled : null,
                pressed && canSend ? styles.pressed : null,
              ]}
            >
              <SendGlyph color={tokens.color.gold.onHouse} />
            </Pressable>
          </View>
          <Text style={[styles.caption, styles.underField]}>
            {savedUntil !== null
              ? askSavedLine(formatAiAnswerDate(savedUntil))
              : ASK_COPY.single_shot}
          </Text>
        </View>
      </BottomSheetModal>
      {consentSheet}
    </>
  );
});

const SOURCE_OPEN_FAILED = "That source didn't open. Try again.";

/**
 * The send arrow, transcribed from `canvas-screens.dc.html` s17 — the visual
 * truth that wins over prose per #937. Colour arrives as a prop for the reason
 * `components/tab-glyphs.tsx` gives.
 */
function SendGlyph({ color, size = 17 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 17 17">
      <Path
        d="M2.5 8.5h9M8 3.5l6 5-6 5"
        stroke={color}
        strokeWidth={1.9}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function createStyles(tokens: SignetTokens) {
  const caption = typeRole(tokens.typography.role.caption);
  return StyleSheet.create({
    scroll: {
      // Takes the space the composer does not, so the composer stays pinned
      // to the sheet's bottom edge at every content length.
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.md,
      gap: tokens.spacing.md,
    },
    headerTitle: {
      // 16/700: `body` is the only 16px role, and the weight rides the
      // per-weight family (`lib/theme.tsx`).
      ...typeRole(tokens.typography.role.body),
      fontFamily: fontFamilyFor(700),
      color: tokens.color.gold.askText,
    },
    emptyBody: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    examples: {
      gap: tokens.spacing.sm,
    },
    example: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    exampleText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    echo: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
    },
    echoText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    caption: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
    composer: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing["2xl"],
      gap: tokens.spacing.sm,
    },
    composerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    underField: {
      // Two lines whichever line it holds, so the saved notice arriving with
      // the status read never moves the field.
      minHeight: (caption.lineHeight ?? 18) * 2,
    },
    composerField: {
      flex: 1,
      height: tokens.touch.button,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      ...fieldTypeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    send: {
      width: 40,
      height: 40,
      borderRadius: tokens.radius.navItem,
      alignItems: "center",
      justifyContent: "center",
      // House gold, fixed. Never the chapter accent on this surface.
      backgroundColor: tokens.color.gold.house,
    },
    sendDisabled: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
