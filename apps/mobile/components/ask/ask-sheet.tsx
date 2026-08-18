import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import Svg, { Path } from "react-native-svg";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetGrabber,
  useSheetBackgroundStyle,
} from "@/components/sheet-scaffold";
import { AnswerCard } from "@/components/ask/answer-card";
import {
  answerQuestion,
  SUGGESTED_QUESTIONS,
  type AskAnswer,
  type AskSource,
} from "@/lib/ask/corpus";
import { askUnavailableReason, isAskAvailable } from "@/lib/ask/flag";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s17 — the ✦ Ask sheet (`canvas-screens.dc.html`, `id="s17"`).
 *
 * A sheet rather than a route: `spec/ui/mobile/patterns.md` § Bottom sheets
 * lists "the s17 Ask presentation" among the flows that are sheets hosted by
 * their parent screen, and `navigation.md:60` makes Ask a global entry that
 * "MUST NOT become a fifth tab". Chat home (s04) and Events (s06) both host it.
 *
 * **Signet gold, never the chapter accent.** Nothing in this file or in
 * `answer-card.tsx` reaches `useChapterBranding()` — `components.md:232` scopes
 * this whole surface to the fixed `gold` token group, because "the answer
 * surface speaks in Signet's voice, not the chapter's". It is the one sheet in
 * the app that does not retint.
 *
 * ## Why fixed snap points rather than dynamic sizing
 *
 * Every other sheet here uses `enableDynamicSizing`, and this one must not. The
 * body grows without bound as answers land — echo card, answer card, wrapping
 * source chips — and dynamic sizing has no cap, so a long answer would size the
 * sheet past the drawn 78% and then re-lay-out when the next one is shorter.
 * The drawing caps at 78% (`patterns.md`: "tall sheets (s17, s20) cap at
 * roughly 78% of the viewport as drawn"), so that is the detent.
 *
 * With fixed detents the body has to scroll, and `BottomSheetScrollView` is a
 * **direct child** of the sheet for the reason `new-task-sheet.tsx` spells out
 * at its second modal: nested inside a `BottomSheetView`, the view and the
 * scrollable write competing heights to the same animated value. The composer
 * is the scrollable's sibling rather than its last row, so it stays pinned
 * above the keyboard as drawn instead of scrolling away under a long answer.
 *
 * ## The flag is not a gate on the entry point
 *
 * `isAskAvailable()` is false by default (`lib/ask/flag.ts`), and the ✦ pill
 * still renders and still opens this sheet when it is. The sheet then states
 * the reason. A control that silently does nothing is the dead end
 * `components.md` §5 bans, and this mirrors the disabled Pay CTA in
 * `lib/payments/stripe.ts` exactly.
 */

/**
 * The drawn cap. A string percentage rather than a computed pixel height, so it
 * tracks the device rather than a phone the drawing was made on.
 */
const ASK_SNAP_POINTS = ["78%"];

/** `rgba(0,0,0,.55)` as drawn; the backdrop's own default is 0.5. */
const SCRIM_OPACITY = 0.55;

/**
 * How long the in-flight state is held.
 *
 * `answerQuestion` is a synchronous lookup, so without this the skeleton would
 * never paint and the state `spec/ui/design-system/README.md` §4 requires — and
 * that `components.md` §11 carries a TODO-DESIGN for — would exist in the code
 * and never on screen. Real retrieval takes longer than this; the number is a
 * placeholder for a network round trip, not a simulation of one.
 */
const ANSWER_DELAY_MS = 450;

export const AskSheet = forwardRef<BottomSheetModal>(
  function AskSheet(_props, ref) {
    const { tokens } = useFrappTheme();
    const styles = createStyles(tokens);
    const backgroundStyle = useSheetBackgroundStyle();

    const available = isAskAvailable();
    const unavailableReason = askUnavailableReason();

    const [draft, setDraft] = useState("");
    /** The question being answered — `null` before the first ask. */
    const [question, setQuestion] = useState<string | null>(null);
    /** `null` while in flight, so `AnswerCard` draws its skeleton. */
    const [answer, setAnswer] = useState<AskAnswer | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = useCallback(() => {
      if (timer.current === null) return;
      clearTimeout(timer.current);
      timer.current = null;
    }, []);

    // The sheet outlives any one exchange, and a pending answer that lands after
    // the member has closed and reopened would overwrite their new question.
    useEffect(() => clearTimer, [clearTimer]);

    const reset = useCallback(() => {
      clearTimer();
      setDraft("");
      setQuestion(null);
      setAnswer(null);
      setNotice(null);
    }, [clearTimer]);

    const ask = useCallback(
      (text: string) => {
        const trimmed = text.trim();
        if (!available || trimmed.length === 0) return;

        clearTimer();
        setQuestion(trimmed);
        setAnswer(null);
        setNotice(null);
        setDraft("");
        timer.current = setTimeout(() => {
          timer.current = null;
          setAnswer(answerQuestion(trimmed));
        }, ANSWER_DELAY_MS);
      },
      [available, clearTimer],
    );

    /**
     * A tapped citation.
     *
     * §11 makes each chip a control that opens its source in-app, and the chips
     * are built as controls. What they cannot do yet is navigate: the corpus is
     * mocked and its sources carry a label, not a document id, so there is
     * nothing to resolve. Saying so is the honest middle — the alternative is a
     * chip that swallows the tap, which is the §5 dead end again.
     *
     * TODO-DESIGN: wire each chip to its source (Documents for a `document`,
     * the thread for a `channel`) once citations arrive with real ids.
     */
    const openSource = useCallback((source: AskSource) => {
      setNotice(
        `${source.label} is a sample citation — there's no real document behind it to open yet.`,
      );
    }, []);

    const trimmedDraft = draft.trim();
    const canSend = available && trimmedDraft.length > 0;
    /**
     * Wired to the control rather than placed beside it: a member using a screen
     * reader lands on a dimmed button and needs the reason *there*, not in a
     * paragraph they may never reach.
     */
    const sendHint =
      unavailableReason ??
      (trimmedDraft.length === 0
        ? "Type a question first."
        : "Send your question to Ask.");

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          // The scrim belongs to the presented sheet only: it fades in at the
          // first detent and is gone once dismissed, so nothing dims a screen
          // that has no sheet over it.
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={SCRIM_OPACITY}
        />
      ),
      [],
    );

    return (
      <BottomSheetModal
        ref={ref}
        // **Required, not redundant.** `enableDynamicSizing` defaults to `true`
        // in gorhom v5, and when it is on the library computes a content-height
        // detent, inserts it into the provided snap points and opens at index 0
        // — the shortest. On first open this sheet's content is a header and two
        // chips, so it would open ~180pt tall while the composer, sized against
        // the 78% detent, laid out below the screen edge: a member could see the
        // header and not reach the input. The whole fixed-detent argument in the
        // docblock above is delivered by this one prop.
        enableDynamicSizing={false}
        snapPoints={ASK_SNAP_POINTS}
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={renderBackdrop}
        onDismiss={reset}
      >
        <BottomSheetScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Not `SheetHeader`: s17 draws no Cancel control — the grabber and the
            scrim are the dismissal — and its title is gold rather than
            foreground, with a trailing caption where Cancel would sit. */}
          <View style={styles.headerRow}>
            <Text style={styles.headerGlyph}>✦</Text>
            <Text style={styles.headerTitle}>Ask Signet</Text>
            <Text style={styles.headerCaption} numberOfLines={2}>
              answers from your chapter&apos;s records
            </Text>
          </View>

          {unavailableReason ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{unavailableReason}</Text>
            </View>
          ) : null}

          {question !== null ? (
            <View style={styles.echo}>
              <Text style={styles.echoText}>{question}</Text>
            </View>
          ) : null}

          {question !== null ? (
            <AnswerCard answer={answer} onOpenSource={openSource} />
          ) : null}

          {notice !== null ? (
            <Text style={styles.sourceNotice}>{notice}</Text>
          ) : null}

          {/* Omitted rather than disabled when Ask is off: the notice above
            already names the blocker once, and a row of dimmed chips repeating
            it would bury it. */}
          {available ? (
            <View style={styles.suggestionRow}>
              {SUGGESTED_QUESTIONS.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  accessibilityRole="button"
                  accessibilityLabel={suggestion}
                  accessibilityHint="Ask this question."
                  // 32pt drawn against the 44pt minimum — the #939 ruling
                  // `ask-pill.tsx` and `sheet-scaffold.tsx` already apply.
                  //
                  // Asymmetric on purpose: the floor is a *vertical* shortfall
                  // (32 + 6 + 6 = 44), and 6pt horizontally would push each
                  // chip 12pt into an 8pt gap, so adjacent chips' touch regions
                  // would overlap and RN would resolve the seam to whichever
                  // view sits later in the hierarchy. A member aiming between
                  // two suggestions would ask the question they did not tap —
                  // and `ask()` clears the draft immediately, so there is no
                  // undo. 4pt a side is exactly half the gap: no overlap.
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  onPress={() => ask(suggestion)}
                  style={({ pressed }) => [
                    styles.suggestion,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={styles.suggestionText}>{suggestion}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </BottomSheetScrollView>

        <View style={styles.composerRow}>
          {/* `BottomSheetTextInput`, never a plain `TextInput`: `patterns.md`
            makes it mandatory inside a sheet, because a plain input breaks the
            sheet's keyboard coordination. */}
          <BottomSheetTextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => ask(draft)}
            editable={available}
            placeholder="Ask anything…"
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Ask a question"
            accessibilityHint={
              unavailableReason ??
              "Ask about your chapter's bylaws, minutes and announcements."
            }
            returnKeyType="send"
            style={styles.composerField}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send question"
            accessibilityHint={sendHint}
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            // 40pt drawn against the 44pt minimum: 2pt a side closes the gap.
            hitSlop={2}
            onPress={() => ask(draft)}
            style={({ pressed }) => [
              styles.send,
              !canSend ? styles.sendDisabled : null,
              pressed && canSend ? styles.pressed : null,
            ]}
          >
            <SendGlyph color={tokens.color.gold.onHouse} />
          </Pressable>
        </View>
      </BottomSheetModal>
    );
  },
);

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
      // Takes the space the composer does not, so the composer stays pinned to
      // the sheet's bottom edge at every content length.
      flex: 1,
    },
    scrollContent: {
      // TODO-DESIGN: Canvas draws the sheet body at padding-x 20 (and
      // `components.md` §9 says 18); `spacing.lg` is 16 and is the nearest step
      // on the locked scale, matching `new-task-sheet.tsx`.
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.md,
      // TODO-DESIGN: Canvas spaces these blocks 16 / 12 / 14 apart; one `md`
      // gap stands in, because a per-child margin off the locked scale would be
      // three near-identical magic numbers.
      gap: tokens.spacing.md,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    headerGlyph: {
      // The ✦ is a **text glyph**, explicitly exempt from the duotone icon
      // recipe (`components.md:235`), so it is not an SVG like the others here.
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.gold.askText,
    },
    headerTitle: {
      // Drawn 16/700. `body` is the only 16px role and carries weight 400, so
      // the weight is lifted through the per-weight family — `fontWeight`
      // alongside an expo-font-registered family resolves the wrong typeface on
      // Android (`lib/theme.tsx`). Size and weight both land exactly.
      ...typeRole(tokens.typography.role.body),
      fontFamily: fontFamilyFor(700),
      color: tokens.color.gold.askText,
    },
    headerCaption: {
      // Right-aligned where `SheetHeader` would put Cancel. s17 has no Cancel.
      flex: 1,
      textAlign: "right",
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    notice: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
    },
    noticeText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    echo: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.lg,
      // TODO-DESIGN: Canvas draws 14 vertical; `spacing.md` is 12 and is the
      // nearest step on the locked scale.
      paddingVertical: tokens.spacing.md,
    },
    echoText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    sourceNotice: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    suggestionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      // TODO-DESIGN: Canvas draws the chip gap at 7; `spacing.sm` is 8.
      gap: tokens.spacing.sm,
    },
    suggestion: {
      justifyContent: "center",
      // Drawn geometry, as `ask-pill.tsx` (36) already carries it; the 44pt
      // floor is met by `hitSlop`, not by the box.
      height: 32,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      // Canvas draws `rgba(255,255,255,.1)`; the structural hairline token is
      // `.08` and `components.md` §2 makes the token canonical, so the token
      // wins over the drawing's pre-lock value.
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    suggestionText: {
      // TODO-DESIGN: Canvas draws these at 13px; `caption` is 12.5 and is the
      // nearest role. Neutral, never gold — the suggestions are chrome that
      // opens the door, and only the answer surface speaks in Signet's gold
      // (`components.md` §11).
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    composerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.md,
      // TODO-DESIGN: Canvas draws 34 at the bottom edge; `spacing.2xl` is 32
      // and is the nearest step on the locked scale.
      paddingBottom: tokens.spacing["2xl"],
    },
    composerField: {
      flex: 1,
      // 46 exactly, which is what `touch.button` is for.
      height: tokens.touch.button,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      // TODO-DESIGN: Canvas draws padding-x 14 and the placeholder at 15.5px;
      // `spacing.md` (12) and the 16px `body` role are the nearest steps.
      paddingHorizontal: tokens.spacing.md,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    send: {
      // Drawn 40×40, below the 44pt floor — met by `hitSlop` above rather than
      // by growing the box, keeping the drawing honest and the target legal.
      width: 40,
      height: 40,
      // TODO-DESIGN: Canvas draws radius 11; `navItem` is 10 and is the nearest
      // role in the locked radius map (foundations.md § Radius) — the same
      // deviation `app/(tabs)/tasks.tsx` carries for its header action.
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
