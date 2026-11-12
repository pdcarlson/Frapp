import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AskExchange } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_REPORT_COPY,
  ASK_COPY,
  askAnswerSegments,
  askLeftOutLine,
  askSourceMetaLine,
  askUnavailableLine,
  type AskAnswer,
  type AskSource,
} from "@repo/validation";
import { eyebrowStyle } from "@/components/eyebrow";
import { fontFamilyFor, tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One Ask exchange on the phone: the answer with a numbered marker at each
 * cited sentence, and the sources those markers open
 * (`spec/ui/design-system/components.md` §11; `spec/behavior/ai.md` § Ask;
 * #450, #451). Web's twin is `apps/web/components/ask/ask-answer.tsx`, and
 * both read the same words (`ASK_COPY`) and cut the answer with the same
 * function (`askAnswerSegments`), so a citation lands on the same sentence in
 * both.
 *
 * Perplexity and Notion AI on a phone do the same two things: a small numbered
 * marker after the sentence it backs, and a list of sources under the answer
 * whose rows are the real tap targets. The marker is tappable too, but a
 * number inside a sentence is a small target, so every source is also a full
 * row below.
 *
 * **Nothing above moves while it works.** The step line ("Searching your
 * chapter's sources") sits under the text, where the sources go when the
 * answer lands, so words stream in above it. The streamed text is a preview:
 * the server decides what stands once the model stops, and that replaces it
 * (`ask.ts`).
 *
 * **Fixed gold, never the chapter accent** (§11): nothing here reaches
 * `useChapterBranding()`.
 *
 * A refusal, "couldn't find that" and "not available" are the product working
 * as designed, not errors, so they keep the same card and plain words.
 */
export function AskExchangeCard({
  exchange,
  canOpen,
  openingSourceId,
  onOpenSource,
  onRetry,
  onAnswerConsent,
  report,
}: {
  exchange: AskExchange;
  /** Whether this build has a screen for the source; a row without one is plain text. */
  canOpen: (source: AskSource) => boolean;
  /** The source whose document link is being fetched, so its row says so. */
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
  const styles = createStyles(tokens);

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      {exchange.phase === "working" ? (
        <>
          {exchange.preview ? (
            <Text style={styles.answer}>{exchange.preview}</Text>
          ) : null}
          <Text style={styles.note}>
            {(ASK_COPY.steps as Record<string, string>)[exchange.step ?? ""] ??
              ASK_COPY.steps.searching}
          </Text>
        </>
      ) : null}

      {exchange.phase === "failed" && exchange.failure ? (
        <>
          <Text style={styles.answer}>{exchange.failure.message}</Text>
          {exchange.failure.retryable ? (
            <CardAction label={ASK_COPY.try_again} onPress={onRetry} />
          ) : null}
        </>
      ) : null}

      {exchange.phase === "done" && exchange.answer ? (
        <AnswerBody
          answer={exchange.answer}
          canOpen={canOpen}
          openingSourceId={openingSourceId ?? null}
          onOpenSource={onOpenSource}
          onAnswerConsent={onAnswerConsent}
        />
      ) : null}

      {/* Anything Ask wrote, or chose not to, can be reported. An answer
          that was never attempted has nothing AI-made in it. Last in the
          card, so it turning into "Reported" moves nothing. */}
      {report &&
      exchange.phase === "done" &&
      exchange.answer &&
      exchange.answer.status !== "unavailable" &&
      exchange.askId ? (
        <CardAction
          label={
            report.reported ? AI_REPORT_COPY.reported : AI_REPORT_COPY.action
          }
          disabled={report.reported}
          onPress={report.onPress}
        />
      ) : null}
    </View>
  );
}

function AnswerBody({
  answer,
  canOpen,
  openingSourceId,
  onOpenSource,
  onAnswerConsent,
}: {
  answer: AskAnswer;
  canOpen: (source: AskSource) => boolean;
  openingSourceId: string | null;
  onOpenSource: (source: AskSource) => void;
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
              {` ${number} `}
            </Text>
          );
        })}
      </Text>
      <AnswerNotes answer={answer} />
      {answer.sources.length > 0 ? (
        <View style={styles.sources}>
          <Text style={[eyebrowStyle(tokens), styles.sourcesHead]}>
            {ASK_COPY.sources}
          </Text>
          {answer.sources.map((source, index) => (
            <SourceRow
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

function SourceRow({
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
  const body = (
    <>
      <Text style={styles.sourceNumber}>{number}</Text>
      <View style={styles.sourceText}>
        <Text style={styles.sourceTitle}>{source.title}</Text>
        {/* The same line whether or not a link is being fetched, so the row
            keeps its height. */}
        <Text style={styles.note}>{opening ? "Opening" : meta}</Text>
      </View>
    </>
  );
  if (!opens) {
    return (
      <View
        accessible
        accessibilityLabel={`Source ${number}: ${source.title}. ${meta}`}
        style={styles.sourceRow}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Source ${number}: ${source.title}. ${meta}`}
      accessibilityHint="Opens this source."
      accessibilityState={{ busy: opening }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sourceRow,
        pressed ? styles.pressed : null,
      ]}
    >
      {body}
    </Pressable>
  );
}

/** A compact secondary action inside the card. */
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
    card: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      // House gold at 35%, per §11: the fixed brand value, never the accent.
      borderColor: tint(tokens.color.gold.house, 0.35),
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
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
      gap: tokens.spacing.xs,
    },
    sourcesHead: {
      color: tokens.color.text.muted,
    },
    sourceRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      alignItems: "center",
    },
    sourceNumber: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(700),
      color: tokens.color.gold.askText,
      width: 18,
    },
    sourceText: {
      flex: 1,
    },
    sourceTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
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
    pressed: {
      opacity: 0.7,
    },
    dimmed: {
      opacity: 0.5,
    },
  });
}
