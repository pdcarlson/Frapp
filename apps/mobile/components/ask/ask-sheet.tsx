import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
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
import {
  BottomSheetModal,
  BottomSheetTextInput,
  type BottomSheetScrollViewMethods,
} from "@gorhom/bottom-sheet";
import {
  useAsk,
  useAskStatus,
  useAskStarter,
  useAskSuggestions,
  useCleanDictation,
  useViewerDisplayName,
  useViewerUserId,
  type AskOptions,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  ASK_COPY,
  ASK_QUESTION_MAX_LENGTH,
  askSavedLine,
  formatAiAnswerDate,
  type AskSuggestion,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/meet-frapp-ai";
import { AskSendGlyph } from "@/components/ask/ask-bar";
import {
  DictationDone,
  DictationHeard,
  DictationListening,
  DictationMic,
  DictationNotice,
  DictationOriginal,
  DictationTidying,
} from "@/components/ask/ask-dictation";
import { AskOpening } from "@/components/ask/ask-opening";
import { AskTurn } from "@/components/ask/ask-turn";
import {
  SOURCE_OPEN_FAILED,
  useAskTurns,
} from "@/components/ask/use-ask-turns";
import { PencilGlyph } from "@/components/control-glyphs";
import { FrappCrest } from "@/components/frapp-crest";
import { ICON_BUTTON_HIT_SLOP, IconButton } from "@/components/icon-button";
import {
  SheetGrabber,
  SheetScrim,
  useSheetBackgroundStyle,
  SheetBackToClose,
  SheetCloseButton,
  useSheetClose,
  useTallSheetProps,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { useActActions, useMayAct } from "@/lib/ai/availability";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useDictation } from "@/lib/dictation/use-dictation";
import {
  fontFamilyFor,
  tint,
  typeRole,
  useFrappTheme,
} from "@/lib/theme";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";
import { ASK_STARTER_STORE } from "@/lib/ask/starter-seen";

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
 * from the Ask Frapp bar above the tab bar (`ask-bar.tsx`, #4702). ChatGPT's,
 * Claude's and Perplexity's phone apps put the field at the bottom above the
 * keyboard and the thread above it; so does this.
 *
 * **Full height** (#4702; it was 78%). A thread of two or three answers with
 * their sources did not fit in the shorter sheet, and the bar it opens from
 * is drawn as this sheet's own field, so a tap should land in a conversation,
 * not in a drawer over the tab. It is the app's tall sheet
 * (`useTallSheetProps`): it stops just under the status bar, the grabber
 * drags it away, and because no scrim is left to tap the header carries a
 * close X (`components.md` § Surface size).
 *
 * **One conversation, one field** (2026-11-13, owner). There were two sides
 * here, Ask and Do, under a switch, each showing one exchange at a time, and
 * a line saying every question was answered on its own. Those apps take a
 * question and a request in the same field and keep the thread on screen so
 * a follow-up can lean on what came before. So the sheet is a thread: each
 * turn stays, the turns before a question are sent with it, and a member who
 * may have Frapp act (`useMayAct`: Ask itself and `ai:act`) gets a card to
 * confirm when what they typed asks for something to be done. Everyone else gets answers only, from
 * the same field. The header's New conversation button clears the thread.
 *
 * The thread is this sitting's: it survives a close and reopen, and is gone
 * when the app restarts. A question asked here and still being answered when
 * the sheet closes is dropped; the turns before it stay. One asked from a
 * channel with `@Frapp` (#4713) is a turn of this same thread, and goes on
 * being answered: its answer is drawn in the channel, which closing the sheet
 * does not take away. What a turn does when the member acts on it is
 * `useAskTurns`, shared with the channel's row.
 *
 * **The field only asks** (#5139; Paul, 2026-11-16). From #4904 until then
 * it searched too, listing channels, members, messages and events above the
 * field while the member typed (Paul's pick of 2026-11-13). Search is its own
 * screen now, pushed from Chat home (`components/search/search-screen.tsx`),
 * which every member has and which can hand its words to this sheet
 * (`initialDraft`). The field and the bar read "Ask Frapp anything" again.
 *
 * **It opens on the member's own account** (#4700, owner 2026-11-13: "not
 * just be like some presets"). Before the first turn the sheet offers up to
 * three questions and one request the server built from what this member's
 * account holds now: their next event, their open tasks, minutes they can
 * read, their points. The same list, in the same words, as web's panel.
 * There is no fixed list; with nothing to ask about, the crest and the
 * greeting stand alone. They are read once the sheet is open and fade in as
 * arrow rows at the bottom, above the field, where nothing sits below them to
 * move. A tapped question is sent as a suggestion, never as words the member
 * typed (`useAsk`'s `suggested`).
 *
 * **It opens on the crest, not on instructions** (#4904; Paul, 2026-11-17).
 * Before the first turn: the crest in the chapter's colour with a glow, the
 * day and a greeting, and on the member's first open on this phone the
 * "What can you do?" exchange (`ask-opening.tsx`, `lib/ask/starter-seen.ts`).
 * Until then every open began with "Ask about your chapter" and a paragraph
 * on where answers come from.
 *
 * **Consent is asked at the first question**, not when the sheet opens
 * (`useAiConsentGate`; `ai.md` § Consent). The question shows in the thread
 * first, so the consent sheet opens with the words it is about already
 * asked. Since #5426 a first question sits just above the field, where the
 * consent sheet rises, so it may sit behind that sheet. The server checks
 * again.
 *
 * **The saved line.** While the beta diagnostics window is on for this
 * chapter, a line above the field says questions and answers are saved and
 * until when, and only then does a question carry `saved_notice_shown`: the
 * server keeps nothing from a client that did not show it. It sits in the
 * composer, which is anchored to the sheet's bottom edge, so its arrival
 * never moves the field. A short thread, which sits on the field (#5426,
 * below), moves up by the line's height, as a chat's last message moves
 * with its composer. Until #5426 it moved nothing.
 *
 * **A source opens the real thing.** A document opens in the in-app browser
 * over the sheet, so the thread is still there when it closes. Anything else
 * is a screen: the sheet closes and the screen opens, and the thread is back
 * when the sheet is reopened.
 *
 * **What is the member's is the chapter's colour** (Paul, 2026-11-13: default
 * 2 on #4698 for the crest, then on the first captures "if Ask Frapp is blue,
 * then so should the button also be blue"): the crest in the header, as on
 * the bar that opened the sheet, the send button, the member's own bubble
 * (`ask-turn.tsx`) and Confirm (`ask-proposal.tsx`). Web's send and Confirm
 * were already the accent. What is Frapp's keeps Ask's fixed gold
 * (`components.md` §11): the source markers and the number on a source chip.
 *
 * **It is drawn on the page's own background, not a sheet's.** At full height
 * this is a screen, and Paul did not like a whole screen of the sheet grey
 * (2026-11-13, on the first captures; his reference is Bevel's assistant,
 * which talks on the app's own dark background). So the fill is
 * `surface.background`, and what sits on it takes the page's ladder
 * (`lib/surfaces.ts`): `surface1` for a suggestion, the field and a card.
 *
 * ## Why one fixed detent rather than dynamic sizing
 *
 * The thread grows as an answer streams in, and dynamic sizing would resize
 * the sheet with every line. So there is one detent, full height; the thread
 * scrolls, and the header and composer are the scrollable's siblings so one
 * stays at the top and the other pinned above the keyboard.
 * `BottomSheetScrollView` is a direct child of the sheet for the reason
 * `new-task-sheet.tsx` gives.
 *
 * ## Why the thread sits on the field, and follows the keyboard (#5426)
 *
 * A thread shorter than the room above the field is drawn at the bottom of
 * that room, on the field, as Messages and ChatGPT's app draw a new
 * conversation: what was just sent appears where the thumb sent it. Until
 * #5426 it was drawn at the top, and the first turn replaced an opening that
 * filled the room and was often scrolled, because the keyboard had shrunk
 * the room under it. On iOS a scroll view keeps its offset when its content
 * shrinks (React Native's `updateState` sets the new content size and leaves
 * the offset alone), so the turn sat above the window and the sheet looked
 * empty until the keyboard moved (Paul, 2026-11-17). Scrolling to the end
 * did not rescue it: the scroll is asked for from JavaScript when the new
 * layout is committed, and reaches the native view on the main queue, where
 * it can run before the shrunk content is mounted and so measures the old
 * content. Now the opening and the thread each get their own scroller, so the
 * first turn arrives in a new one at offset zero, and the content always
 * fills the room. While the member is following, every scroll to the end is
 * asked for again on the next frame, after the new content is mounted, so a
 * streamed line or a card that folds to one line is measured as it now is.
 *
 * Dragging the thread puts the keyboard away (#5429): the field is not the
 * keyboard's own accessory view, so it can't follow an interactive drag of
 * the keyboard. The sheet hears only that the keyboard will show or hide, and
 * under "interactive" iOS moves the keyboard with the finger first. The sheet
 * still held the field at the old keyboard top, over an empty band.
 *
 * The keyboard changes the room, not the content, so `onContentSizeChange`
 * does not see it. The scroller's own layout does: while the member is
 * reading the newest words, a change in the room scrolls to the end again,
 * so those words stay above the field as the keyboard opens and closes.
 *
 * Whether a member has Ask at all is the host's question (`useAiSurfaces`):
 * with the server's AI off, nothing mounts this.
 */

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
    /**
     * A question to open with, in the box for the member to send or change
     * (a nudge card's "Ask about this", #4781). Never sent on its own. Read
     * once, when the sheet mounts: a host gives each question its own `key`.
     */
    initialDraft?: string;
  }
>(function AskSheet({ onClosed, initialDraft }, ref) {
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const { accent, accentPrimary, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const sheetBackground = useSheetBackgroundStyle();
  // The sheet's shape with the page's fill: see "drawn on the page's own
  // background" above.
  const backgroundStyle = useMemo(
    () => [
      sheetBackground,
      { backgroundColor: tokens.color.surface.background },
    ],
    [sheetBackground, tokens],
  );
  const tallSheet = useTallSheetProps();

  const {
    exchanges,
    working,
    ask,
    retry,
    setProposal,
    resolveProposal,
    resolveCard,
    stop,
    reset,
  } = useAsk();
  const [shownOpen, setShownOpen] = useState(false);
  const status = useAskStatus({ enabled: shownOpen });
  const { ensureConsent, consentSheet } = useAiConsentGate();

  // What this member can ask to have done (#718), or nothing.
  const actions = useActActions({ enabled: shownOpen });
  const canAct = actions.length > 0;
  const mayAct = useMayAct();
  const { suggestions } = useAskSuggestions({ enabled: shownOpen });
  const displayName = useViewerDisplayName();
  const viewerId = useViewerUserId();
  const opening = useAskStarter({
    userId: viewerId,
    open: shownOpen,
    empty: exchanges.length === 0,
    canAct,
    store: ASK_STARTER_STORE,
  });

  const [draft, setDraft] = useState(initialDraft ?? "");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Tidied dictation just landed: what the Original chip puts back, until the
  // member types or sends (#5276).
  const [original, setOriginal] = useState<{
    tidied: string;
    restore: string;
  } | null>(null);
  const cleanDictation = useCleanDictation();
  const dictation = useDictation({
    clean: cleanDictation,
    onText: (text, heard) => {
      const before = draftRef.current;
      const tidied = joinDraft(before, text);
      const restore = joinDraft(before, heard);
      setDraft(tidied);
      setOriginal(tidied === restore ? null : { tidied, restore });
    },
  });
  const listening = dictation.phase === "listening";
  const tidying = dictation.phase === "cleaning";
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

  // Keeps the newest words in view while the member is reading them: now,
  // and again on the next frame, once the layout that asked is mounted
  // (#5426, above).
  const follow = useCallback(() => {
    if (!following.current) return;
    scroller.current?.scrollToEnd?.({ animated: false });
    requestAnimationFrame(() => {
      if (following.current) {
        scroller.current?.scrollToEnd?.({ animated: false });
      }
    });
  }, []);

  // A new turn shows the newest words.
  useEffect(() => {
    following.current = true;
    dragged.current = false;
    scroller.current?.scrollToEnd?.({ animated: true });
  }, [lastId]);

  // A question asked here and still being answered is dropped with the
  // sheet; the turns before it are there when it reopens. One asked from a
  // channel goes on: its answer is drawn there.
  const workingRef = useRef(working);
  const askedHere = exchanges.some(
    (exchange) => exchange.phase === "working" && !exchange.origin,
  );
  const askedHereRef = useRef(askedHere);
  useEffect(() => {
    workingRef.current = working;
    askedHereRef.current = askedHere;
  }, [working, askedHere]);
  const cancelDictation = dictation.cancel;
  const onDismiss = useCallback(() => {
    setShownOpen(false);
    cancelDictation();
    if (askedHereRef.current) stop();
    const left = leftForSource.current;
    leftForSource.current = false;
    onClosed?.(left);
  }, [onClosed, stop, cancelDictation]);

  const options = useCallback(
    (): AskOptions => ({
      savedNoticeShown: savedUntil !== null,
      // Asked for on the permission alone. The list of actions only words
      // the opening: a request typed before it arrives, or after it failed
      // to load, must still come back as a card.
      actions: mayAct,
      gate: ensureConsent,
    }),
    [mayAct, ensureConsent, savedUntil],
  );

  // The screen is about to be on top: the host must not navigate over it.
  const leave = useCallback(() => {
    leftForSource.current = true;
    closeSheet();
  }, [closeSheet]);
  const turns = useAskTurns({
    conversation: { working, retry, setProposal, resolveProposal, resolveCard },
    options,
    leave,
  });
  const clearNotice = turns.clearNotice;

  const submit = useCallback(
    (text: string) => {
      if (!text.trim() || workingRef.current) return;
      setDraft("");
      setOriginal(null);
      clearNotice();
      void ask(text, options());
    },
    [ask, options, clearNotice],
  );

  const pick = useCallback(
    (suggestion: AskSuggestion) => {
      if (workingRef.current) return;
      clearNotice();
      // A question can name a record someone else wrote, so it is sent as a
      // suggestion. The one request holds none and is sent like typed words.
      void ask(suggestion.text, {
        ...options(),
        suggested: !suggestion.request,
      });
    },
    [ask, options, clearNotice],
  );

  const canSend = draft.trim().length > 0 && !working && !tidying;

  return (
    <>
      <BottomSheetModal
        ref={ref}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        // Full height, with dynamic sizing off: left on (gorhom v5's
        // default) the sheet opens at its content height, a header and three
        // rows, and the composer lays out below the screen edge.
        {...tallSheet}
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
          {/* Before the first turn the opening's big crest is the mark, and
              the bar that opened the sheet already said "Ask Frapp"; the
              name comes back here with the conversation (#4904). */}
          {exchanges.length > 0 ? (
            <View style={styles.headerName}>
              <FrappCrest height={20} color={accent} />
              <Text accessibilityRole="header" style={styles.headerTitle}>
                {ASK_COPY.name}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <View style={styles.headerActions}>
            {exchanges.length > 0 ? (
              <IconButton
                label={ASK_COPY.new_conversation}
                onPress={() => {
                  reset();
                  turns.forget();
                  clearNotice();
                }}
              >
                <PencilGlyph color={tokens.color.text.mutedForeground} />
              </IconButton>
            ) : null}
            {/* At full height no scrim is left to tap: every tall sheet's
                own close control (`sheet-scaffold.tsx`). */}
            <SheetCloseButton
              accessibilityLabel={ASK_COPY.close}
              onPress={closeSheet}
            />
          </View>
        </View>
        <BottomSheetScrollView
          // A new scroller when the first turn replaces the opening, and
          // back: the old one's offset belongs to content that is gone
          // (#5426, above).
          key={exchanges.length > 0 ? "thread" : "opening"}
          ref={scroller}
          onAccessibilityEscape={closeSheet}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          // A drag on the thread puts the keyboard away at once (#5429).
          // The library's default, "interactive", lets iOS move the
          // keyboard under the finger without telling the sheet, which
          // keeps the field where the keyboard's top was, over an empty
          // band. ChatGPT's and Claude's apps put it away on the drag too.
          keyboardDismissMode="on-drag"
          // The keyboard opening or closing changes the room, not the
          // content: the newest words stay above the field (#5426).
          onLayout={follow}
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
          onContentSizeChange={follow}
        >
          {exchanges.length > 0 ? (
            exchanges.map((exchange) => (
              <View key={exchange.id} style={styles.turn}>
                <AskTurn {...turns.propsFor(exchange)} />
                {turns.sourceFailed(exchange.id) ? (
                  <Text accessibilityLiveRegion="polite" style={styles.caption}>
                    {SOURCE_OPEN_FAILED}
                  </Text>
                ) : null}
              </View>
            ))
          ) : (
            <AskOpening
              displayName={displayName}
              mode={opening.mode}
              onStarterShown={opening.starterShown}
              canAct={canAct}
              suggestions={suggestions}
              onPick={pick}
            />
          )}
        </BottomSheetScrollView>

        <View style={styles.composer}>
          {savedUntil !== null ? (
            <Text style={styles.caption}>
              {askSavedLine(formatAiAnswerDate(savedUntil))}
            </Text>
          ) : null}
          {listening ? <DictationHeard words={dictation.words} /> : null}
          {dictation.failure !== null && dictation.phase === "idle" ? (
            <DictationNotice
              failure={dictation.failure}
              onDismiss={dictation.dismiss}
            />
          ) : null}
          {original !== null && dictation.phase === "idle" ? (
            <DictationOriginal
              onPress={() => {
                setDraft(original.restore);
                setOriginal(null);
              }}
            />
          ) : null}
          <View style={styles.composerRow}>
            <View
              style={[
                styles.field,
                listening
                  ? { borderColor: accent, backgroundColor: tint(accent) }
                  : null,
              ]}
            >
              {listening ? (
                <DictationListening
                  levels={dictation.levels}
                  seconds={dictation.seconds}
                  onCancel={dictation.cancel}
                  accent={accent}
                />
              ) : tidying ? (
                <DictationTidying words={dictation.words} />
              ) : (
                <>
                  {/* `BottomSheetTextInput`, never a plain `TextInput`
                      (`patterns.md` § Bottom sheets). Multiline, so a
                      dictated paragraph shows whole, up to five lines. */}
                  <BottomSheetTextInput
                    value={draft}
                    onChangeText={(next) => {
                      setDraft(next);
                      if (original !== null && next !== original.tidied) {
                        setOriginal(null);
                      }
                    }}
                    onSubmitEditing={() => submit(draft)}
                    multiline
                    submitBehavior="submit"
                    maxLength={ASK_QUESTION_MAX_LENGTH}
                    placeholder={ASK_COPY.placeholder}
                    placeholderTextColor={tokens.color.text.muted}
                    accessibilityLabel={ASK_COPY.placeholder}
                    returnKeyType="send"
                    style={styles.composerField}
                  />
                  {dictation.available ? (
                    <DictationMic
                      onPress={() => {
                        setOriginal(null);
                        dictation.start();
                      }}
                    />
                  ) : null}
                </>
              )}
            </View>
            {listening ? (
              <DictationDone
                onPress={dictation.finish}
                fill={accentPrimary}
                color={accentOnPrimary}
              />
            ) : (
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
                  { backgroundColor: accentPrimary },
                  !canSend ? styles.sendDisabled : null,
                  pressed && canSend ? styles.pressed : null,
                ]}
              >
                <AskSendGlyph color={accentOnPrimary} />
              </Pressable>
            )}
          </View>
        </View>
      </BottomSheetModal>
      {consentSheet}
      {turns.reportSheet}
    </>
  );
});

/** The composer's line height: chat's, so a dictated paragraph reads the same. */
const FIELD_LINE_HEIGHT = 20;
const FIELD_MAX_LINES = 5;
const FIELD_BORDER = 1;

/** Typed or tidied words after what is already in the field. */
function joinDraft(before: string, added: string): string {
  const head = before.trimEnd();
  const next = head ? `${head} ${added.trim()}` : added.trim();
  return next.slice(0, ASK_QUESTION_MAX_LENGTH);
}

function createStyles(tokens: SignetTokens) {
  // What is left of the 44pt field once one line and the border are drawn,
  // split above and below.
  const fieldPaddingY =
    (tokens.touch.button - FIELD_LINE_HEIGHT - 2 * FIELD_BORDER) / 2;
  return StyleSheet.create({
    scroll: {
      // Takes the space the header and the composer do
      // not, so the composer stays pinned to the sheet's bottom edge at
      // every thread length.
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.md,
      gap: tokens.spacing.xl,
      // At least the room above the field, with a short thread at its
      // bottom, on the field (#5426). The opening fills it: its crest in the
      // middle and its rows at the bottom, in thumb reach (`ask-opening.tsx`).
      flexGrow: 1,
      justifyContent: "flex-end",
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
      // The close X sits on the thread's right edge.
      paddingHorizontal: tokens.spacing.lg,
      // The buttons' height, so the title never moves when the first turn
      // brings New conversation in beside the close.
      minHeight: 36,
    },
    headerTitle: {
      // 16/700: `body` is the only 16px role, and the weight rides the
      // per-weight family (`lib/theme.tsx`).
      ...typeRole(tokens.typography.role.body),
      fontFamily: fontFamilyFor(700),
      color: tokens.color.text.foreground,
    },
    headerName: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      // Each icon button's slop reaches 12pt past its box, so the two touch
      // areas never overlap (`sheet-scaffold.tsx` § headerActions).
      gap: ICON_BUTTON_HIT_SLOP * 2,
    },
    turn: {
      gap: tokens.spacing.sm,
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
      // A field grown to several lines keeps send at its foot, by the thumb.
      alignItems: "flex-end",
      gap: tokens.spacing.sm,
    },
    field: {
      flex: 1,
      flexDirection: "row",
      alignItems: "flex-end",
      minHeight: tokens.touch.button,
      // A capsule at one line, the shape of the bar that opened the sheet; a
      // rounded box as dictated lines grow it.
      borderRadius: tokens.touch.button / 2,
      borderWidth: FIELD_BORDER,
      borderColor: tokens.color.border.control,
      backgroundColor: tokens.color.surface.surface1,
      // Centres the 32pt mic on a one-line field's midline.
      paddingRight: (tokens.touch.button - 2 * FIELD_BORDER - 32) / 2,
      paddingBottom: (tokens.touch.button - 2 * FIELD_BORDER - 32) / 2,
    },
    composerField: {
      flex: 1,
      // One line at the field's 44pt, five before it scrolls.
      maxHeight: FIELD_LINE_HEIGHT * FIELD_MAX_LINES + 2 * fieldPaddingY,
      // Top and bottom set apart, not `paddingVertical`: iOS gives a multiline
      // input a default top inset that only an explicit `paddingTop` replaces
      // (`chat-composer.tsx`, the same field shape). The negative margin
      // undoes the row's bottom padding, which is the mic's.
      paddingTop: fieldPaddingY,
      paddingBottom: fieldPaddingY,
      marginBottom: -(tokens.touch.button - 2 * FIELD_BORDER - 32) / 2,
      paddingLeft: tokens.spacing.lg,
      paddingRight: tokens.spacing.sm,
      ...typeRole({
        ...tokens.typography.role.body,
        lineHeight: FIELD_LINE_HEIGHT,
      }),
      includeFontPadding: false,
      textAlignVertical: "center",
      color: tokens.color.text.foreground,
    },
    send: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      // The fill is the chapter's solid accent, set where it is drawn.
    },
    sendDisabled: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
