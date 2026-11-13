import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetScrollViewMethods,
} from "@gorhom/bottom-sheet";
import Svg, { Path } from "react-native-svg";
import {
  useAsk,
  useAskStatus,
  useDocumentDownloadUrl,
  type AskExchange,
  type AskOptions,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  ACT_COPY,
  ASK_COPY,
  ASK_QUESTION_MAX_LENGTH,
  askSavedLine,
  formatAiAnswerDate,
  type AskSource,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/ai-consent-sheet";
import {
  useAiReport,
  type AiReportTarget,
} from "@/components/ai/report-ai-sheet";
import {
  AskProposal,
  type ActLink,
  type KeptTargets,
} from "@/components/ask/ask-proposal";
import { AskTurn } from "@/components/ask/ask-turn";
import { PencilGlyph } from "@/components/control-glyphs";
import {
  SheetGrabber,
  SheetScrim,
  useSheetBackgroundStyle,
  SheetBackToClose,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { useActActions } from "@/lib/ai/availability";
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
 * `spec/behavior/ai.md` § One conversation; #450, #451, #718): one
 * conversation with Frapp, over wherever the member is. They type in one
 * field; Frapp answers from the chapter's own documents, minutes and
 * records, each claim marked with the source it came from, or shows a card
 * for something they asked to have done. It reads the same stream web's
 * panel does (`useAsk`), in the same words (`ASK_COPY`).
 *
 * A member asks walking to class, so the whole thing is one sheet, opened
 * from the tab bar's + (`quick-actions-panel.tsx`). ChatGPT's, Claude's and
 * Perplexity's phone apps put the field at the bottom above the keyboard and
 * the thread above it; so does this.
 *
 * **One conversation, one field** (2026-11-13, owner). There were two sides
 * here, Ask and Do, under a switch, each showing one exchange at a time, and
 * a line saying every question was answered on its own. Those apps take a
 * question and a request in the same field and keep the thread on screen so
 * a follow-up can lean on what came before. So the sheet is a thread: each
 * turn stays, the turns before a question are sent with it, and a member who
 * may have Frapp act (`useActActions`: Ask itself, `ai:act`, and a
 * permission to do at least one thing) gets a card to confirm when what they
 * typed asks for something to be done. Everyone else gets answers only, from
 * the same field. The header's New conversation button clears the thread.
 *
 * The thread is this sitting's: it survives a close and reopen, and is gone
 * when the app restarts. A question still being answered when the sheet
 * closes is dropped; the turns before it stay.
 *
 * **Consent is asked at the first question**, not when the sheet opens
 * (`useAiConsentGate`; `ai.md` § Consent). The question shows in the thread
 * first, so the consent sheet opens over the words it is about. The server
 * checks again.
 *
 * **The saved line.** While the beta diagnostics window is on for this
 * chapter, a line above the field says questions and answers are saved and
 * until when, and only then does a question carry `saved_notice_shown`: the
 * server keeps nothing from a client that did not show it. It sits in the
 * composer, which is anchored to the sheet's bottom edge, so its arrival
 * moves neither the field nor the top of the thread.
 *
 * **A source opens the real thing.** A document opens in the in-app browser
 * over the sheet, so the thread is still there when it closes. Anything else
 * is a screen: the sheet closes and the screen opens, and the thread is back
 * when the sheet is reopened.
 *
 * **Fixed gold, never the chapter accent** (`components.md` §11): nothing in
 * this file, `ask-turn.tsx` or `ask-proposal.tsx` reaches
 * `useChapterBranding()`.
 *
 * ## Why fixed snap points rather than dynamic sizing
 *
 * The thread grows as an answer streams in, and dynamic sizing would resize
 * the sheet with every line. The drawing caps at 78% (`patterns.md`), so
 * that is the one detent; the thread scrolls, and the header and composer
 * are the scrollable's siblings so one stays at the top and the other pinned
 * above the keyboard. `BottomSheetScrollView` is a direct child of the sheet
 * for the reason `new-task-sheet.tsx` gives.
 *
 * Whether a member has Ask at all is the host's question (`useAiSurfaces`):
 * with the server's AI off, nothing mounts this.
 */

const ASK_SNAP_POINTS = ["78%"];

/** Within this of the bottom, the member is reading the newest words. */
const FOLLOW_SLACK = 80;

export const AskSheet = forwardRef<
  BottomSheetModal,
  {
    /**
     * The sheet closed. `leftForSource` is true when it closed because the
     * member opened a source's screen, which is now on top: a host must not
     * navigate over it.
     */
    onClosed?: (leftForSource: boolean) => void;
  }
>(function AskSheet({ onClosed }, ref) {
  const closeSheet = useSheetClose(ref);
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();

  const {
    exchanges,
    working,
    ask,
    retry,
    setProposal,
    resolveProposal,
    stop,
    reset,
  } = useAsk();
  const [shownOpen, setShownOpen] = useState(false);
  const status = useAskStatus({ enabled: shownOpen });
  const { ensureConsent, consentSheet } = useAiConsentGate();
  const reporting = useAiReport();
  const openDocument = useDocumentDownloadUrl();

  // What this member can ask to have done (#718), or nothing.
  const actions = useActActions({ enabled: shownOpen });
  const canAct = actions.length > 0;
  const [kept, setKept] = useState<KeptTargets>({});

  const [draft, setDraft] = useState("");
  const [openingSourceId, setOpeningSourceId] = useState<string | null>(null);
  // A source that didn't open, said under the turn it belongs to.
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const presenting = useRef(false);
  const leftForSource = useRef(false);
  const scroller = useRef<BottomSheetScrollViewMethods>(null);
  // Whether the member is reading the newest words: only then does the
  // thread follow an answer as it grows.
  const following = useRef(true);
  // Only the member's own drag can stop the thread following. The scroll a
  // new turn starts reports offsets short of the end while it animates, and
  // read as the member's they would leave the answer below the fold.
  const dragged = useRef(false);

  const savedUntil = status.data?.saved_until ?? null;
  const lastId = exchanges.at(-1)?.id;

  // A new turn shows the newest words.
  useEffect(() => {
    following.current = true;
    dragged.current = false;
    scroller.current?.scrollToEnd?.({ animated: true });
  }, [lastId]);

  // A question still being answered is dropped with the sheet; the turns
  // before it are there when it reopens.
  const workingRef = useRef(working);
  useEffect(() => {
    workingRef.current = working;
  }, [working]);
  const onDismiss = useCallback(() => {
    setShownOpen(false);
    if (workingRef.current) stop();
    const left = leftForSource.current;
    leftForSource.current = false;
    onClosed?.(left);
  }, [onClosed, stop]);

  const options = useCallback(
    (): AskOptions => ({
      savedNoticeShown: savedUntil !== null,
      actions: canAct,
      gate: ensureConsent,
    }),
    [canAct, ensureConsent, savedUntil],
  );

  const submit = useCallback(
    (text: string) => {
      if (!text.trim() || workingRef.current) return;
      setDraft("");
      setSourceNotice(null);
      void ask(text, options());
    },
    [ask, options],
  );

  const canOpen = useCallback(
    (source: AskSource) => askSourceOpening(source) !== null,
    [],
  );

  const openSource = useCallback(
    async (exchangeId: string, source: AskSource) => {
      const opening = askSourceOpening(source);
      if (!opening) return;
      if (opening.kind === "route") {
        leftForSource.current = true;
        closeSheet();
        openHref(router, asRoute(notificationHref(opening.target)));
        return;
      }
      // One browser at a time: iOS rejects a second presentation.
      if (presenting.current) return;
      presenting.current = true;
      setSourceNotice(null);
      setOpeningSourceId(`${exchangeId}:${source.id}`);
      try {
        const url = selectDownloadUrl(
          await openDocument.mutateAsync(opening.documentId),
        );
        if (!url) {
          setSourceNotice(exchangeId);
          return;
        }
        await WebBrowser.openBrowserAsync(url);
      } catch {
        setSourceNotice(exchangeId);
      } finally {
        presenting.current = false;
        setOpeningSourceId(null);
      }
    },
    [closeSheet, openDocument, router],
  );

  const canSend = draft.trim().length > 0 && !working;

  const openActLink = useCallback(
    (link: ActLink) => {
      // The screen is about to be on top: the host must not navigate over it.
      leftForSource.current = true;
      closeSheet();
      openHref(router, asRoute(link.href));
    },
    [closeSheet, router],
  );

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
        <View style={styles.headerRow}>
          <Text accessibilityRole="header" style={styles.headerTitle}>
            {ASK_COPY.name}
          </Text>
          {exchanges.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={ASK_COPY.new_conversation}
              // 36pt drawn against the 44pt minimum.
              hitSlop={4}
              onPress={() => {
                reset();
                setKept({});
                setSourceNotice(null);
              }}
              style={({ pressed }) => [
                styles.headerAction,
                pressed ? styles.pressed : null,
              ]}
            >
              <PencilGlyph
                size={18}
                color={tokens.color.text.mutedForeground}
              />
            </Pressable>
          ) : null}
        </View>
        <BottomSheetScrollView
          ref={scroller}
          onAccessibilityEscape={closeSheet}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => {
            dragged.current = true;
          }}
          onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (!dragged.current) return;
            const { contentOffset, contentSize, layoutMeasurement } =
              event.nativeEvent;
            following.current =
              contentSize.height - contentOffset.y - layoutMeasurement.height <
              FOLLOW_SLACK;
          }}
          // The newest turn growing keeps its last line in view, unless the
          // member scrolled up to read something else.
          onContentSizeChange={() => {
            if (following.current) {
              scroller.current?.scrollToEnd?.({ animated: false });
            }
          }}
        >
          {exchanges.length > 0 ? (
            exchanges.map((exchange) => (
              <View key={exchange.id} style={styles.turn}>
                <AskTurn
                  exchange={exchange}
                  canOpen={canOpen}
                  openingSourceId={
                    openingSourceId?.startsWith(`${exchange.id}:`)
                      ? openingSourceId.slice(exchange.id.length + 1)
                      : null
                  }
                  onOpenSource={(source) =>
                    void openSource(exchange.id, source)
                  }
                  onRetry={() => void retry(exchange.id, options())}
                  onAnswerConsent={() => void retry(exchange.id, options())}
                  report={reportFor(exchange, reporting)}
                  proposal={
                    exchange.proposal ? (
                      <AskProposal
                        proposal={exchange.proposal}
                        resolution={exchange.resolution}
                        kept={kept}
                        onKeep={(id, targets) =>
                          setKept((current) => ({ ...current, [id]: targets }))
                        }
                        report={reporting}
                        onProposal={(next) => setProposal(exchange.id, next)}
                        onResolved={(resolution) =>
                          resolveProposal(exchange.id, resolution)
                        }
                        onAnswerConsent={() =>
                          void retry(exchange.id, options())
                        }
                        onOpen={openActLink}
                      />
                    ) : null
                  }
                />
                {sourceNotice === exchange.id ? (
                  <Text accessibilityLiveRegion="polite" style={styles.caption}>
                    {SOURCE_OPEN_FAILED}
                  </Text>
                ) : null}
              </View>
            ))
          ) : (
            <AskEmpty
              actions={canAct ? actions : null}
              onPick={submit}
              styles={styles}
            />
          )}
        </BottomSheetScrollView>

        <View style={styles.composer}>
          {savedUntil !== null ? (
            <Text style={styles.caption}>
              {askSavedLine(formatAiAnswerDate(savedUntil))}
            </Text>
          ) : null}
          <View style={styles.composerRow}>
            {/* `BottomSheetTextInput`, never a plain `TextInput`
                (`patterns.md` § Bottom sheets). */}
            <BottomSheetTextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => submit(draft)}
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
              onPress={() => submit(draft)}
              style={({ pressed }) => [
                styles.send,
                !canSend ? styles.sendDisabled : null,
                pressed && canSend ? styles.pressed : null,
              ]}
            >
              <SendGlyph color={tokens.color.gold.onHouse} />
            </Pressable>
          </View>
        </View>
      </BottomSheetModal>
      {consentSheet}
      {reporting.reportSheet}
    </>
  );
});

/**
 * Before the first turn: what Frapp answers from, and a few things to try.
 * A member Frapp can act for is told so, and offered one request beside the
 * questions.
 */
function AskEmpty({
  actions,
  onPick,
  styles,
}: {
  /** The actions this member can ask for, or null when they cannot. */
  actions: readonly string[] | null;
  onPick: (text: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const request = (actions ?? []).flatMap((action) => {
    const example = (ACT_COPY.examples as Record<string, string>)[action];
    return example ? [example] : [];
  })[0];
  const examples = [...ASK_COPY.examples, ...(request ? [request] : [])];
  return (
    <>
      <View style={styles.emptyWords}>
        <Text style={styles.emptyTitle}>{ASK_COPY.empty_title}</Text>
        <Text style={styles.emptyBody}>
          {ASK_COPY.empty_body}
          {actions ? ` ${ASK_COPY.empty_body_act}` : ""}
        </Text>
      </View>
      <View style={styles.examples}>
        {examples.map((example) => (
          <Pressable
            key={example}
            accessibilityRole="button"
            accessibilityLabel={example}
            accessibilityHint="Sends this."
            onPress={() => onPick(example)}
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
  );
}

/** The answer's "Report this", for a member who may report (#4315). */
function reportFor(
  exchange: AskExchange,
  reporting: ReturnType<typeof useAiReport>,
) {
  if (!reporting.offered || !exchange.askId) return null;
  const target: AiReportTarget = {
    subject: "ask_answer",
    subjectId: exchange.askId,
    receipt: exchange.answer?.report_receipt ?? null,
  };
  return {
    reported: reporting.isReported(target),
    onPress: () => reporting.report(target),
  };
}

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
  return StyleSheet.create({
    scroll: {
      // Takes the space the header and composer do not, so the composer
      // stays pinned to the sheet's bottom edge at every thread length.
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.md,
      gap: tokens.spacing.xl,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
      paddingLeft: tokens.spacing.lg,
      paddingRight: tokens.spacing.sm,
      // The button's height, with or without it, so the title never moves
      // when the first turn arrives.
      minHeight: 36,
    },
    headerTitle: {
      // 16/700: `body` is the only 16px role, and the weight rides the
      // per-weight family (`lib/theme.tsx`).
      ...typeRole(tokens.typography.role.body),
      fontFamily: fontFamilyFor(700),
      color: tokens.color.gold.askText,
    },
    headerAction: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radius.navItem,
    },
    turn: {
      gap: tokens.spacing.sm,
    },
    emptyWords: {
      gap: tokens.spacing.xs,
    },
    emptyTitle: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
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
      paddingVertical: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    exampleText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
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
    composerField: {
      flex: 1,
      height: tokens.touch.button,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.control,
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
