import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useAskThumbs, useChannels, type AskExchange } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_REPORT_COPY,
  ASK_COPY,
  ASK_EFFORT_COPY,
  ASK_FEEDBACK_COPY,
  ASK_FEEDBACK_REASONS,
  ASK_POST_COPY,
  askAnswerEntities,
  askFeedbackReportReason,
  askAnswerSegments,
  askEntityParts,
  askLeftOutLine,
  askOffersThinkHarder,
  askPostedSourceTitle,
  askReadLine,
  askSourceChip,
  askStepLine,
  askUnavailableLine,
  type AiReportReason,
  type AskAnswer,
  type AskNamedEntity,
  type AskPostedAnswer,
  type AskSource,
} from "@repo/validation";
import {
  CheckGlyph,
  CopyGlyph,
  FlagGlyph,
  LightbulbGlyph,
  ThumbDownGlyph,
  ThumbUpGlyph,
} from "@/components/control-glyphs";
import { IconButton } from "@/components/icon-button";
import { useChapterBranding } from "@/lib/chapter-branding";
import { selectChannels } from "@/lib/chat/channel-list";
import { selectionHaptic } from "@/lib/haptics";
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
 * chapter's sources") sits under the text, so words stream in above it. The
 * streamed text is a preview: the server decides what stands once the model
 * stops, and that replaces it (`ask.ts`).
 *
 * **The answer is the loudest thing in its turn** (Paul, 2026-11-13: "there
 * just needs to be better hierarchy", "report shouldn't be so obvious", and
 * the conversation "should feel more agentic"). Under the words, in the step
 * line's place and tone, a line says what Frapp read to write them ("Read
 * the events calendar and 3 sources"), as ChatGPT keeps "Thought for 12s"
 * and Perplexity its count of sources. Then the source chips. Last, two
 * small muted icons, Copy and Report, the row of quiet icons ChatGPT, Claude
 * and Gemini end an answer with. The words "Report this" stood there alone
 * and read as the thing to do next.
 *
 * **The member's bubble is the chapter's colour; Frapp's marks are gold.**
 * The bubble takes the solid accent and its contrast-checked text colour
 * (Paul, 2026-11-13; `ask-sheet.tsx`). The markers and the number on a source
 * chip keep Ask's fixed gold (§11) and never read the chapter's colour.
 *
 * A refusal, "couldn't find that" and "not available" are the product working
 * as designed, not errors, so they read as plain answers.
 */
/** "Report this" for an answer, as the turn's row draws it. */
export interface AskTurnReport {
  reported: boolean;
  onPress: () => void;
  /**
   * Opens the same sheet on a reason already given, from a thumbs down
   * (#4904). Left out, a thumbs down offers no send.
   */
  onSend?: (reason: AiReportReason) => void;
}

export function AskTurn({
  exchange,
  proposal,
  cards,
  canOpen,
  openingSourceId,
  onOpenSource,
  busy = false,
  onRetry,
  onThinkHarder,
  onAnswerConsent,
  report,
  onOpenChannel,
}: {
  exchange: AskExchange;
  /**
   * Another turn is being answered. Asking this one again would abandon it,
   * so this turn's Try again and consent buttons wait.
   */
  busy?: boolean;
  /** The card for a turn that asked for something to be done, in the answer's place. */
  proposal?: ReactNode;
  /** The cards the answer came with (`answer.proposals`), drawn under it. */
  cards?: ReactNode;
  /** Whether this build has a screen for the source; a chip without one is plain. */
  canOpen: (source: AskSource) => boolean;
  /** The source whose document link is being fetched, so its chip says so. */
  openingSourceId?: string | null;
  onOpenSource: (source: AskSource) => void;
  /** Asks the same question again, after a failure that may not repeat. */
  onRetry: () => void;
  /**
   * Asks the same question again in this turn's place with more effort
   * (#4904). Left out, the answer offers no Think harder.
   */
  onThinkHarder?: () => void;
  /** Opens the AI sheet, for an answer refused because it is unanswered. */
  onAnswerConsent: () => void;
  /**
   * "Report this" for the answer (#4315), where the member may report. Left
   * out, or null, draws nothing.
   */
  report?: AskTurnReport | null;
  /**
   * Opens a channel the answer names (#4904), offered only for a channel the
   * reader has. Left out, a channel's name is the plain words.
   */
  onOpenChannel?: (channelId: string) => void;
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
      <AskReply
        exchange={exchange}
        proposal={proposal}
        cards={cards}
        canOpen={canOpen}
        openingSourceId={openingSourceId}
        onOpenSource={onOpenSource}
        busy={busy}
        onRetry={onRetry}
        onThinkHarder={onThinkHarder}
        onAnswerConsent={onAnswerConsent}
        report={report}
        onOpenChannel={onOpenChannel}
      />
    </View>
  );
}

type AskReplyProps = Parameters<typeof AskTurn>[0];

/**
 * What Frapp came back with for one turn: the words as they arrive, then the
 * answer or the card, or the failure. `AskTurn` draws it under the question's
 * bubble; a channel draws it under Frapp's name for a turn asked there with
 * `@Frapp` (`ask-in-channel.tsx`, #4713), so an answer reads the same in both
 * places.
 */
export function AskReply({
  exchange,
  proposal,
  cards,
  canOpen,
  openingSourceId,
  onOpenSource,
  busy = false,
  onRetry,
  onThinkHarder,
  onAnswerConsent,
  report,
  onOpenChannel,
}: AskReplyProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
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
            readLine={askReadLine(exchange.read)}
            canOpen={canOpen}
            openingSourceId={openingSourceId ?? null}
            onOpenSource={onOpenSource}
            busy={busy}
            onAnswerConsent={onAnswerConsent}
            onOpenChannel={onOpenChannel}
          />
        ) : null}

        {exchange.phase === "done" && exchange.answer ? cards : null}

        {/* Anything Ask wrote, or chose not to, can be reported; what it
            wrote can be copied. An answer that was never attempted has
            nothing AI-made in it. Last in the turn, so Copy turning into
            Copied and Report into Reported move nothing. */}
        {exchange.phase === "done" &&
        exchange.answer &&
        exchange.answer.status !== "unavailable" ? (
          exchange.answer.ask_id ? (
            <RatedAnswerActions
              // A turn asked again is a new answer: its thumbs start empty.
              key={exchange.answer.ask_id}
              askId={exchange.answer.ask_id}
              text={
                exchange.answer.status === "answered"
                  ? exchange.answer.text
                  : null
              }
              report={exchange.askId ? (report ?? null) : null}
              thinkHarder={
                onThinkHarder &&
                askOffersThinkHarder(exchange.answer, exchange.effort)
                  ? { busy, onPress: onThinkHarder }
                  : null
              }
            />
          ) : (
            <AnswerActions
              thumbs={null}
              text={
                exchange.answer.status === "answered"
                  ? exchange.answer.text
                  : null
              }
              report={exchange.askId ? (report ?? null) : null}
            />
          )
        ) : null}
      </View>
  );
}

/** How long Copy reads "Copied" before it goes back: web's `COPIED_RESET_MS`. */
const COPIED_RESET_MS = 2000;

/** The glyph in the row under an answer: smaller than a header's 20pt. */
const ACTION_GLYPH_SIZE = 16;

/**
 * The row under an answer: Copy, the thumbs, then Report. Glyphs alone in the
 * muted text tone, each with the icon button's 44pt touch area, so nothing
 * here competes with the answer above it.
 *
 * The thumbs (#4904, `spec/behavior/ai.md` § Feedback on an answer) are drawn
 * only for an answer whose turn the server kept a trace of (`answer.ask_id`,
 * {@link RatedAnswerActions}): a rating has nothing to be recorded against
 * otherwise. What a thumbs opens sits under the row ({@link ThumbsFollowUp});
 * web's twin is `ask-thumbs.tsx`.
 */
function AnswerActions({
  thumbs,
  text,
  report,
  thinkHarder = null,
}: {
  /**
   * Think harder, where this answer offers it (`askOffersThinkHarder`): the
   * same question again in this turn's place with more effort. It waits
   * while another turn is being answered.
   */
  thinkHarder?: { busy: boolean; onPress: () => void } | null;
  /** The answer's thumbs, or null when the server kept no trace to rate. */
  thumbs: ReturnType<typeof useAskThumbs> | null;
  /** The answer's words, without the markers, or null when there are none to copy. */
  text: string | null;
  report: AskTurnReport | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const color = tokens.color.text.mutedForeground;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const strong = tokens.color.text.foreground;

  if (!text && !report && !thumbs) return null;
  const copy = () => {
    if (!text) return;
    void Clipboard.setStringAsync(text).then(
      () => {
        if (!mounted.current) return;
        selectionHaptic();
        AccessibilityInfo.announceForAccessibility(ASK_COPY.copied_answer);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          setCopied(false);
        }, COPIED_RESET_MS);
      },
      // Nothing was copied, so the control goes on reading Copy.
      () => undefined,
    );
  };
  return (
    <View style={styles.actionsBlock}>
      <View style={styles.actions}>
        {text ? (
          <IconButton
            label={copied ? ASK_COPY.copied_answer : ASK_COPY.copy_answer}
            onPress={copy}
          >
            {copied ? (
              <CheckGlyph color={color} size={ACTION_GLYPH_SIZE} />
            ) : (
              <CopyGlyph color={color} size={ACTION_GLYPH_SIZE} />
            )}
          </IconButton>
        ) : null}
        {thumbs ? (
          <>
            <IconButton
              label={ASK_FEEDBACK_COPY.up}
              selected={thumbs.state.rating === "up"}
              onPress={() => {
                selectionHaptic();
                thumbs.rate("up");
              }}
            >
              <ThumbUpGlyph
                color={thumbs.state.rating === "up" ? strong : color}
                size={ACTION_GLYPH_SIZE}
                chosen={thumbs.state.rating === "up"}
              />
            </IconButton>
            <IconButton
              label={ASK_FEEDBACK_COPY.down}
              selected={thumbs.state.rating === "down"}
              onPress={() => {
                selectionHaptic();
                thumbs.rate("down");
              }}
            >
              <ThumbDownGlyph
                color={thumbs.state.rating === "down" ? strong : color}
                size={ACTION_GLYPH_SIZE}
                chosen={thumbs.state.rating === "down"}
              />
            </IconButton>
          </>
        ) : null}
        {thinkHarder ? (
          <IconButton
            label={ASK_EFFORT_COPY.action}
            disabled={thinkHarder.busy}
            onPress={thinkHarder.onPress}
          >
            <View style={thinkHarder.busy ? styles.dimmed : null}>
              <LightbulbGlyph color={color} size={ACTION_GLYPH_SIZE} />
            </View>
          </IconButton>
        ) : null}
        {report ? (
          <IconButton
            // Named for what it reports, as web's icon is: there are no
            // words beside it to say so.
            label={
              report.reported
                ? AI_REPORT_COPY.reported
                : AI_REPORT_COPY.titles.ask_answer
            }
            disabled={report.reported}
            onPress={report.onPress}
          >
            <View style={report.reported ? styles.dimmed : null}>
              <FlagGlyph color={color} size={ACTION_GLYPH_SIZE} />
            </View>
          </IconButton>
        ) : null}
      </View>
      {thumbs ? (
        <ThumbsFollowUp
          key={thumbs.state.rating ?? "none"}
          rating={thumbs.state.rating}
          reason={thumbs.state.reason}
          failed={thumbs.failed}
          onReason={thumbs.giveReason}
          reported={report?.reported ?? false}
          send={report && !report.reported ? (report.onSend ?? null) : null}
        />
      ) : null}
    </View>
  );
}

/** The row for an answer the server kept a trace of, with its thumbs. */
function RatedAnswerActions({
  askId,
  ...row
}: {
  askId: string;
  text: string | null;
  report: AskTurnReport | null;
  thinkHarder: { busy: boolean; onPress: () => void } | null;
}) {
  return <AnswerActions thumbs={useAskThumbs(askId)} {...row} />;
}

/**
 * What a thumbs opens under the row. An up gets one line of thanks. A down
 * asks why in one tap, then says the rating carried none of the words and
 * offers to send the answer through Report this, which opens on the reason
 * already given. "Not now", and a report sent while it is open, fold it back
 * to the thanks line; an answer reported before the thumbs still gets its
 * reasons, without the offer. Keyed by the rating, so a change of thumb
 * starts it over.
 */
function ThumbsFollowUp({
  rating,
  reason,
  failed,
  onReason,
  send,
  reported,
}: {
  /** The answer has been reported, from here or from the flag. */
  reported: boolean;
  rating: "up" | "down" | null;
  reason: string | null;
  failed: boolean;
  onReason: (reason: (typeof ASK_FEEDBACK_REASONS)[number]) => void;
  /** Opens Report this on a reason, or null where there is nothing to offer. */
  send: ((reason: AiReportReason) => void) | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [closed, setClosed] = useState(false);
  const [reportedBefore] = useState(reported);

  if (failed) {
    return (
      <Text accessibilityRole="alert" style={styles.feedbackFailed}>
        {ASK_FEEDBACK_COPY.failed}
      </Text>
    );
  }
  if (rating === null) return null;
  if (rating === "up" || closed || (reported && !reportedBefore)) {
    return (
      <Text accessibilityLiveRegion="polite" style={styles.note}>
        {ASK_FEEDBACK_COPY.thanks}
      </Text>
    );
  }
  return (
    <View style={styles.feedback}>
      <Text style={styles.note}>{ASK_FEEDBACK_COPY.prompt}</Text>
      <View style={styles.sources}>
        {ASK_FEEDBACK_REASONS.map((option) => {
          const chosen = reason === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={ASK_FEEDBACK_COPY.reasons[option]}
              accessibilityState={{ selected: chosen }}
              // 36pt drawn against the 44pt minimum.
              hitSlop={4}
              onPress={() => {
                selectionHaptic();
                onReason(option);
              }}
              style={({ pressed }) => [
                styles.action,
                chosen ? styles.reasonChosen : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={styles.actionText}>
                {ASK_FEEDBACK_COPY.reasons[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {send ? (
        <>
          <Text style={styles.note}>{ASK_FEEDBACK_COPY.send.line}</Text>
          <View style={styles.feedbackLinks}>
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => send(askFeedbackReportReason(reason))}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <Text style={styles.feedbackLink}>
                {ASK_FEEDBACK_COPY.send.action}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => setClosed(true)}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <Text style={styles.note}>{ASK_FEEDBACK_COPY.send.dismiss}</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

function AnswerBody({
  answer,
  readLine,
  canOpen,
  openingSourceId,
  onOpenSource,
  busy,
  onAnswerConsent,
  onOpenChannel,
}: {
  answer: AskAnswer;
  /** What Frapp read to write it (`askReadLine`), or null. */
  readLine: string | null;
  canOpen: (source: AskSource) => boolean;
  openingSourceId: string | null;
  onOpenSource: (source: AskSource) => void;
  busy: boolean;
  onAnswerConsent: () => void;
  onOpenChannel?: (channelId: string) => void;
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

  const entities = askAnswerEntities(answer);
  const words = (canOpenChannel: (channelId: string) => boolean) => (
    <Text style={styles.answer}>
      {askAnswerSegments(answer).map((segment, position) => {
        if (segment.type === "text") {
          return (
            <EntityText
              key={position}
              text={segment.text}
              entities={entities}
              mentionStyle={styles.mention}
              canOpenChannel={canOpenChannel}
              onOpenChannel={onOpenChannel}
            />
          );
        }
        const source = answer.sources[segment.citation.source];
        if (!source) return null;
        const number = segment.citation.source + 1;
        const opens = canOpen(source);
        return (
          <Text
            key={position}
            accessibilityRole={opens ? "link" : undefined}
            accessibilityLabel={`Source ${number}: ${askSourceChip(source).name}`}
            onPress={opens ? () => onOpenSource(source) : undefined}
            style={styles.marker}
          >
            {/* No-break spaces: the marker wraps whole, with the sentence it ends. */}
            {`\u00A0${number}\u00A0`}
          </Text>
        );
      })}
    </Text>
  );

  return (
    <>
      {/* The reader's channel list is only read for an answer that names one. */}
      {/* An answer that is cards and nothing else has no words to draw. */}
      {!answer.text ? null : onOpenChannel &&
        entities.some((entity) => entity.type === "channel") ? (
        <ChannelOpens>{words}</ChannelOpens>
      ) : (
        words(() => false)
      )}
      {/* Where the step line was while it worked, in the same tone. */}
      {readLine ? <Text style={styles.note}>{readLine}</Text> : null}
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

/**
 * A run of an answer's text with the people and channels it names drawn the
 * way chat draws a mention (#4904; `message-markdown.tsx`), as Discord and
 * Slack mark a name inside a sentence. Which names count is the server's
 * call (`askEntityParts`): a name that is not in `entities` is ordinary
 * text. Web's twin is `ask-entity-text.tsx`.
 *
 * A member is a highlight. A channel is also a link into that channel, when
 * the reader has it; one they cannot open stays the plain words.
 */
function EntityText({
  text,
  entities,
  mentionStyle,
  canOpenChannel,
  onOpenChannel,
}: {
  text: string;
  entities: readonly AskNamedEntity[];
  mentionStyle: StyleProp<TextStyle>;
  canOpenChannel: (channelId: string) => boolean;
  onOpenChannel?: (channelId: string) => void;
}) {
  return (
    <>
      {askEntityParts(text, entities).map((part, position) => {
        if (part.type === "text") {
          return <Text key={position}>{part.text}</Text>;
        }
        if (part.type === "member") {
          return (
            <Text key={position} style={mentionStyle}>
              {part.text}
            </Text>
          );
        }
        if (!onOpenChannel || !canOpenChannel(part.id)) {
          return <Text key={position}>{part.text}</Text>;
        }
        return (
          <Text
            key={position}
            accessibilityRole="link"
            onPress={() => onOpenChannel(part.id)}
            style={mentionStyle}
          >
            {part.text}
          </Text>
        );
      })}
    </>
  );
}

/**
 * Which channels in an answer this reader can open: the ones in their own
 * channel list. Drawn only around an answer that names a channel, so no
 * other answer reads the list. Web's twin is `AskChannelOpens`.
 */
function ChannelOpens({
  children,
}: {
  children: (canOpenChannel: (channelId: string) => boolean) => ReactNode;
}) {
  const channels = useChannels().data;
  const mine = useMemo(
    () => new Set(selectChannels(channels).map((channel) => channel.id)),
    [channels],
  );
  return children((channelId) => mine.has(channelId));
}

/**
 * An answer posted to a channel (`ask_answer`, #4713), drawn as its asker
 * saw it: the same words, markers and chips, from the posted row. Web's twin
 * is `AskPostedBody` in `apps/web/components/ask/ask-answer.tsx`.
 *
 * A marker carries no quoted passage here: the quote stayed with the asker,
 * so a reader who can't open a source sees its name and nothing of its text.
 * The asker's own records are named as theirs ("Sam Abernathy's tasks") and
 * open nothing, since a reader's Tasks page is the reader's own.
 */
export function AskPostedBody({
  text,
  posted,
  askerName,
  canOpen,
  openingSourceId,
  onOpenSource,
}: {
  /** The row's `content`: the answer's words, which the markers count into. */
  text: string;
  posted: AskPostedAnswer;
  /** The asker's roster name, or null when the roster can't name them. */
  askerName: string | null;
  canOpen: (source: AskSource) => boolean;
  openingSourceId: string | null;
  onOpenSource: (source: AskSource) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const sources: AskSource[] = posted.sources.map((source, index) => ({
    id: String(index),
    kind: source.kind,
    title: askPostedSourceTitle(source, askerName),
    detail: source.detail,
    date: source.date,
    target: source.target,
  }));
  const segments = askAnswerSegments({
    text,
    citations: posted.citations.map((citation) => ({ ...citation, quote: "" })),
  });
  const notes: string[] = [
    ...(posted.truncated ? [ASK_COPY.truncated] : []),
    ...(posted.sources.some((source) => source.limited)
      ? [ASK_POST_COPY.limited]
      : []),
  ];
  return (
    <View style={styles.reply}>
      <Text style={styles.answer}>
        {segments.map((segment, position) => {
          if (segment.type === "text") {
            return <Text key={position}>{segment.text}</Text>;
          }
          const source = sources[segment.citation.source];
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
              {`\u00A0${number}\u00A0`}
            </Text>
          );
        })}
      </Text>
      {sources.length > 0 ? (
        <View style={styles.sources}>
          {sources.map((source, index) => (
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
      {notes.length > 0 ? (
        <View style={styles.notes}>
          {notes.map((note) => (
            <Text key={note} style={styles.note}>
              {note}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
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
  // A quoted message says whose it is and when (`askSourceChip`, #4904).
  const { name, when, meta } = askSourceChip(source);
  const label = `Source ${number}: ${name}. ${meta}`;
  const body = (
    <>
      <Text style={styles.sourceNumber}>{number}</Text>
      <Text numberOfLines={1} style={styles.sourceTitle}>
        {name}
      </Text>
      {when ? (
        <Text numberOfLines={1} style={styles.sourceWhen}>
          {when}
        </Text>
      ) : null}
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
    // Chat's in-body mention chip (`message-markdown.tsx`): colour only, so a
    // name can't change its line's height.
    mention: {
      backgroundColor: tokens.color.semantic.mentionChip,
      color: tokens.color.semantic.mentionChipText,
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
    sourceWhen: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      flexShrink: 0,
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
    actionsBlock: {
      gap: tokens.spacing.md,
    },
    feedback: {
      gap: tokens.spacing.sm,
    },
    feedbackFailed: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
    feedbackLinks: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xl,
    },
    feedbackLink: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    reasonChosen: {
      borderColor: tokens.color.text.foreground,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      // Two 20pt boxes, each reaching 44pt by slop: this keeps the two
      // touch areas from overlapping.
      gap: tokens.spacing.xl,
    },
    pressed: {
      opacity: 0.7,
    },
    dimmed: {
      opacity: 0.5,
    },
  });
}
