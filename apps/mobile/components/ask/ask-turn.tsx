import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AskExchange } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_REPORT_COPY,
  ASK_COPY,
  askAnswerSegments,
  askLeftOutLine,
  askSourceMetaLine,
  askStepLine,
  askUnavailableLine,
  type AskAnswer,
  type AskSource,
} from "@repo/validation";
import { useChapterBranding } from "@/lib/chapter-branding";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One turn of the Ask conversation on the phone: what the member typed, then
 * what Frapp came back with. That is an answer with a numbered marker at
 * each cited sentence and the sources those markers open
 * (`spec/ui/design-system/components.md` §11; `spec/behavior/ai.md` § Ask;
 * #450, #451), or the card for something the member asked to have done
 * (`ask-proposal.tsx`, passed in as `proposal`). Web's twin is
 * `apps/web/components/ask/ask-answer.tsx`, and both read the same words
 * (`ASK_COPY`) and cut the answer with the same function
 * (`askAnswerSegments`), so a citation lands on the same sentence in both.
 *
 * **Who said what is told by shape, not by labels.** The member's words sit
 * in a bubble on the right; Frapp's answer is plain text on the left with no
 * frame, the way ChatGPT's, Claude's and Perplexity's phone apps draw a
 * conversation with one person and one assistant. Only a proposal, which is
 * a thing to act on, is a card.
 *
 * **Sources are chips under the answer**, as Perplexity and Notion AI draw
 * them: the number its markers carry, then its name. The marker inside the
 * sentence is tappable too, but a number in a line of text is a small
 * target, so every source is also a chip with a full-height touch area. What
 * kind of source it is and its date are in the chip's spoken name, so a
 * thread of several answers stays short.
 *
 * **Nothing above moves while it works.** The step line ("Searching your
 * chapter's sources") sits under the text, where the sources go when the
 * answer lands, so words stream in above it. The streamed text is a preview:
 * the server decides what stands once the model stops, and that replaces it
 * (`ask.ts`).
 *
 * **The member's bubble is the chapter's colour; Frapp's marks are gold.**
 * The bubble takes the solid accent and its contrast-checked text colour
 * (Paul, 2026-11-13; `ask-sheet.tsx`). The markers and the number on a source
 * chip keep Ask's fixed gold (§11) and never read the chapter's colour.
 *
 * A refusal, "couldn't find that" and "not available" are the product working
 * as designed, not errors, so they read as plain answers.
 */
export function AskTurn({
  exchange,
  proposal,
  canOpen,
  openingSourceId,
  onOpenSource,
  busy = false,
  onRetry,
  onAnswerConsent,
  report,
}: {
  exchange: AskExchange;
  /**
   * Another turn is being answered. Asking this one again would abandon it,
   * so this turn's Try again and consent buttons wait.
   */
  busy?: boolean;
  /** The card for a turn that asked for something to be done, in the answer's place. */
  proposal?: ReactNode;
  /** Whether this build has a screen for the source; a chip without one is plain. */
  canOpen: (source: AskSource) => boolean;
  /** The source whose document link is being fetched, so its chip says so. */
  openingSourceId?: string | null;
  onOpenSource: (source: AskSource) => void;
  /** Asks the same question again, after a failure that may not repeat. */
  onRetry: () => void;
  /** Opens the AI sheet, for an answer refused because it is unanswered. */
  onAnswerConsent: () => void;
  /**
   * "Report this" for the answer (#4315), where the member may report. Left
   * out, or null, draws nothing.
   */
  report?: { reported: boolean; onPress: () => void } | null;
}) {
  const { tokens } = useFrappTheme();
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);

  return (
    <View style={styles.turn}>
      <View style={[styles.bubble, { backgroundColor: accentPrimary }]}>
        <Text
          accessibilityRole="header"
          style={[styles.answer, { color: accentOnPrimary }]}
        >
          {exchange.question}
        </Text>
      </View>
      <View style={styles.reply} accessibilityLiveRegion="polite">
        {exchange.phase === "working" ? (
          <>
            {exchange.preview ? (
              <Text style={styles.answer}>{exchange.preview}</Text>
            ) : null}
            {exchange.step ? (
              <Text style={styles.note}>
                {askStepLine(exchange.step, exchange.stepDetail)}
              </Text>
            ) : null}
          </>
        ) : null}

        {exchange.phase === "failed" && exchange.failure ? (
          <>
            <Text style={styles.answer}>{exchange.failure.message}</Text>
            {exchange.failure.retryable ? (
              <CardAction
                label={ASK_COPY.try_again}
                onPress={onRetry}
                disabled={busy}
              />
            ) : null}
          </>
        ) : null}

        {exchange.phase === "done" && exchange.proposal ? proposal : null}

        {exchange.phase === "done" && exchange.answer ? (
          <AnswerBody
            answer={exchange.answer}
            canOpen={canOpen}
            openingSourceId={openingSourceId ?? null}
            onOpenSource={onOpenSource}
            busy={busy}
            onAnswerConsent={onAnswerConsent}
          />
        ) : null}

        {/* Anything Ask wrote, or chose not to, can be reported. An answer
            that was never attempted has nothing AI-made in it. Last in the
            turn, so it turning into "Reported" moves nothing. */}
        {report &&
        exchange.phase === "done" &&
        exchange.answer &&
        exchange.answer.status !== "unavailable" &&
        exchange.askId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              report.reported ? AI_REPORT_COPY.reported : AI_REPORT_COPY.action
            }
            accessibilityState={report.reported ? { disabled: true } : undefined}
            disabled={report.reported}
            hitSlop={12}
            onPress={report.onPress}
            style={({ pressed }) => [
              styles.report,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.note}>
              {report.reported ? AI_REPORT_COPY.reported : AI_REPORT_COPY.action}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function AnswerBody({
  answer,
  canOpen,
  openingSourceId,
  onOpenSource,
  busy,
  onAnswerConsent,
}: {
  answer: AskAnswer;
  canOpen: (source: AskSource) => boolean;
  openingSourceId: string | null;
  onOpenSource: (source: AskSource) => void;
  busy: boolean;
  onAnswerConsent: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  if (answer.status === "unavailable") {
    return (
      <>
        <Text style={styles.answer}>{askUnavailableLine(answer.reason)}</Text>
        {answer.reason === "consent_required" ? (
          <CardAction
            label={ASK_COPY.consent_action}
            onPress={onAnswerConsent}
            disabled={busy}
          />
        ) : null}
      </>
    );
  }
  if (answer.status === "refused") {
    return <Text style={styles.answer}>{ASK_COPY.refused}</Text>;
  }
  if (answer.status === "not_found") {
    return (
      <>
        <Text style={styles.answer}>{ASK_COPY.not_found}</Text>
        <Text style={styles.note}>{ASK_COPY.not_found_hint}</Text>
        <AnswerNotes answer={answer} />
      </>
    );
  }

  return (
    <>
      <Text style={styles.answer}>
        {askAnswerSegments(answer).map((segment, position) => {
          if (segment.type === "text") {
            return <Text key={position}>{segment.text}</Text>;
          }
          const source = answer.sources[segment.citation.source];
          if (!source) return null;
          const number = segment.citation.source + 1;
          const opens = canOpen(source);
          return (
            <Text
              key={position}
              accessibilityRole={opens ? "link" : undefined}
              accessibilityLabel={`Source ${number}: ${source.title}`}
              onPress={opens ? () => onOpenSource(source) : undefined}
              style={styles.marker}
            >
              {/* No-break spaces: the marker wraps whole, with the sentence it ends. */}
              {`\u00A0${number}\u00A0`}
            </Text>
          );
        })}
      </Text>
      <AnswerNotes answer={answer} />
      {answer.sources.length > 0 ? (
        <View style={styles.sources}>
          {answer.sources.map((source, index) => (
            <SourceChip
              key={source.id}
              number={index + 1}
              source={source}
              opens={canOpen(source)}
              opening={openingSourceId === source.id}
              onPress={() => onOpenSource(source)}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

/** What the member should know before relying on the answer. Each only when true. */
function AnswerNotes({ answer }: { answer: AskAnswer }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const notes = [
    answer.unverified_citations > 0 ? ASK_COPY.unverified : null,
    answer.truncated ? ASK_COPY.truncated : null,
    answer.left_out_messages > 0
      ? askLeftOutLine(answer.left_out_messages)
      : null,
  ].filter((note): note is string => note !== null);
  if (notes.length === 0) return null;
  return (
    <View style={styles.notes}>
      {notes.map((note) => (
        <Text key={note} style={styles.note}>
          {note}
        </Text>
      ))}
    </View>
  );
}

/**
 * One source as a chip: the number its markers carry, then its name. 36pt
 * drawn, with the touch area filled out to 44pt by the gap between rows.
 */
function SourceChip({
  number,
  source,
  opens,
  opening,
  onPress,
}: {
  number: number;
  source: AskSource;
  opens: boolean;
  opening: boolean;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const meta = askSourceMetaLine(source);
  const label = `Source ${number}: ${source.title}. ${meta}`;
  const body = (
    <>
      <Text style={styles.sourceNumber}>{number}</Text>
      <Text numberOfLines={1} style={styles.sourceTitle}>
        {source.title}
      </Text>
    </>
  );
  if (!opens) {
    return (
      <View accessible accessibilityLabel={label} style={styles.chip}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens this source."
      accessibilityState={{ busy: opening }}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        // Dimmed while its link is fetched: the chip keeps its size.
        pressed || opening ? styles.pressed : null,
      ]}
    >
      {body}
    </Pressable>
  );
}

/** A compact secondary action under an answer. */
function CardAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      // 36pt drawn against the 44pt minimum.
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        pressed ? styles.pressed : null,
        disabled ? styles.dimmed : null,
      ]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    turn: {
      gap: tokens.spacing.md,
    },
    bubble: {
      alignSelf: "flex-end",
      maxWidth: "85%",
      borderRadius: 18,
      borderBottomRightRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: tokens.spacing.sm,
    },
    reply: {
      gap: tokens.spacing.md,
    },
    answer: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    marker: {
      // Weight and colour only: size and line height come from the sentence
      // around it, so the marker can't change a line's height.
      fontFamily: fontFamilyFor(700),
      color: tokens.color.gold.askText,
      backgroundColor: tokens.color.gold.askFill,
    },
    notes: {
      gap: tokens.spacing.xs,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    sources: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 36,
      maxWidth: "100%",
      paddingLeft: 10,
      paddingRight: tokens.spacing.md,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    sourceNumber: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(700),
      color: tokens.color.gold.askText,
    },
    sourceTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    action: {
      alignSelf: "flex-start",
      height: 36,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    actionText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    report: {
      alignSelf: "flex-start",
    },
    pressed: {
      opacity: 0.7,
    },
    dimmed: {
      opacity: 0.5,
    },
  });
}
