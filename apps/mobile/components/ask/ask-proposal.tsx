import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  useBottomSheetInternal,
} from "@gorhom/bottom-sheet";
import { codeOf } from "@repo/api-sdk";
import {
  memberFallbackLabel,
  useAcceptAiSuggestion,
  useAskCards,
  useActEventAudience,
  useChapterRoster,
  useCurrentUser,
  useDismissAiSuggestion,
  settleProposedEvent,
  type ActResponse,
  type AiSuggestion,
  type AskCardEnd,
  type AskProposalResolution,
  type PointsSuggestionEdits,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  ACT_COPY,
  ASK_CARDS_COPY,
  AI_REPORT_COPY,
  actActionLabel,
  actAttendanceLine,
  actConfirmRefusalLine,
  actEventPointsInput,
  actEventPointsLine,
  actMissingLine,
  actPointsAction,
  actPointsFromLine,
  actRepeatParts,
  actWhenParts,
  actNoteLine,
  actPointsDoneLine,
  actPointsEdits,
  actPointsHeadline,
  actPointsTotalLine,
  actWhenLine,
  meetingDueLabel,
} from "@repo/validation";
import type { useAiReport } from "@/components/ai/report-ai-sheet";
import { CloseGlyph } from "@/components/control-glyphs";
import { OverflowGlyph } from "@/components/chat/overflow-glyph";
import { AskCardGlyph, type AskCardGlyphName } from "./ask-card-glyphs";
import { eyebrowStyle } from "@/components/eyebrow";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { NewEventSheet } from "@/components/events/new-event-sheet";
import {
  NewTaskSheet,
  type TaskSuggestionSeed,
} from "@/components/tasks/new-task-sheet";
import type { KeptTargets } from "@/lib/ask/kept-targets";
import { proposedEventTemplate } from "@/lib/ask/proposed-event-template";
import { useChapterBranding } from "@/lib/chapter-branding";
import { suggestionEdits } from "@/lib/tasks/suggestion-edits";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";
import { BottomSheetFlatList } from "@/lib/sheet-scrollables";

/**
 * A proposal in the Ask conversation on the phone (#718,
 * `spec/behavior/ai.md` § Asking Frapp to do something): an officer leaving
 * chapter types "give 5 points to everyone who came tonight" in the same
 * field a question goes in, and gets back a card that says exactly what
 * would happen and to whom. Nothing changes until they press Confirm. Web's
 * twin is `apps/web/components/ask/ask-proposal.tsx`; both read the same
 * stream (`useAsk`) and the same words (`ACT_COPY`).
 *
 * **A card to confirm, in the thread where it was asked.** Siri and
 * Shortcuts answer a spoken request with the thing filled in and a Confirm
 * before anything is sent, and Apple's Reminders and Calendar suggestions
 * show what would be added before it is. The card here is that: the action
 * as a title, the size of a bulk change in words ("Give 5 points to 42
 * members"), each detail on its own line, and Confirm beside Cancel.
 *
 * **What can be fixed on the card is what a request leaves unsaid.** Who a
 * points change is for: take a member off, or add one a name did not find,
 * from a roster to search (a chapter is a hundred members, so it is a tall
 * sheet with a search field, not a menu). A task opens the ordinary task
 * form on the proposal, the same door a suggested task has
 * (`suggested-tasks.tsx`), so who, when and the steps are changed where an
 * officer already changes them.
 *
 * **Every card has Edit beside Cancel** (Paul, 2026-11-15, #5117: "it got
 * the general idea down, but I'd love to be able to add attendance and change
 * the time"). Gmail's Smart Compose and Siri's suggested reminders hand the
 * draft to the ordinary editor rather than growing their own, and Calendar's
 * "Add to calendar" on an event found in mail opens the full event editor.
 * So Edit opens the form the officer already uses: an event opens New event
 * filled in from the card (attendance by role, the end, notes, the repeat),
 * and its Create is the confirm; a task opens the task form. A points card
 * has no form of its own on the phone, so Edit turns its amount and reason
 * into fields on the card. Both forms keep what was typed when closed (#4593).
 *
 * **Every card in the thread stays live.** A card is not replaced by the
 * next thing asked. Once it is confirmed or dismissed it becomes one line
 * saying so, in the card's own frame, with a way to where the change shows.
 *
 * **Nothing above moves while it works.** Confirm and Cancel keep their
 * words while they save.
 *
 * **Confirm is the chapter's colour**, as the send button is and as web's
 * Confirm always was (Paul, 2026-11-13; `ask-sheet.tsx`). The card sits on
 * the page's background, so it takes `surface1` and its notes `card`
 * (`lib/surfaces.ts`).
 */

/** Where a finished change can be seen. */
export type ActLink = { href: string; label: string };

/**
 * Where a confirmed change can be seen, by the page the card named. The
 * phone has no points page to open (`notifications/targets.ts`).
 */
const RESULT_LINKS: Record<string, ActLink> = {
  tasks: { href: "/tasks", label: ACT_COPY.open_tasks },
  events: { href: "/events", label: ACT_COPY.open_events },
};

/** The lists kept on points cards (`lib/ask/kept-targets.tsx`). */
export type { KeptTargets };

type Reporting = ReturnType<typeof useAiReport>;

export function AskProposal({
  proposal,
  resolution,
  kept,
  onKeep,
  report,
  onProposal,
  onResolved,
  onOpen,
}: {
  /** What the server answered the member's words with. */
  proposal: ActResponse;
  /** Set once the card was confirmed or dismissed. */
  resolution: AskProposalResolution | null;
  kept: KeptTargets;
  onKeep: (suggestionId: string, targets: string[]) => void;
  report: Reporting;
  /** The event pick answered with a new proposal for this turn. */
  onProposal: (proposal: ActResponse) => void;
  onResolved: (resolution: AskProposalResolution) => void;
  /** Leaves the sheet for the screen a finished change shows on. */
  onOpen: (link: ActLink) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const audience = useActEventAudience();
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (resolution) {
    return (
      <FinishedCard
        headline={
          proposal.suggestion ? cardHeadline(proposal.suggestion) : null
        }
        resolution={resolution}
        onOpen={onOpen}
        styles={styles}
      />
    );
  }

  async function pickEvent(eventId: string) {
    const choice = proposal.event_choice;
    if (!choice || picking) return;
    setProblem(null);
    setPicking(true);
    try {
      onProposal(
        await audience.mutateAsync({
          eventId,
          amount: choice.amount,
          reason: choice.reason,
          // The other cards in the thread stay waiting.
          keepEarlier: true,
        }),
      );
    } catch (error) {
      setProblem(errorCopy(error, ACT_COPY.failed));
    } finally {
      setPicking(false);
    }
  }

  return (
    <View style={styles.block}>
      <ActAnswer
        response={proposal}
        busy={picking}
        kept={kept}
        onKeep={onKeep}
        report={report}
        onPickEvent={(eventId) => void pickEvent(eventId)}
        onDone={(line, page, made) =>
          onResolved({ kind: "done", line, page, ...made })
        }
        onCancelled={(shown) => onResolved({ kind: "cancelled", shown })}
        onGone={(shown) => onResolved({ kind: "gone", shown })}
        styles={styles}
      />
      {problem ? (
        <Text accessibilityRole="alert" style={styles.problem}>
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

/** What the card was about, in a few words, once it is one line. */
function cardHeadline(suggestion: AiSuggestion): string | null {
  if (suggestion.task) return suggestion.task.title;
  if (suggestion.new_event) return suggestion.new_event.name;
  return suggestion.points?.reason ?? null;
}

type Styles = ReturnType<typeof createStyles>;

/** Where a finished change can be opened: the event itself, else its tab. */
function resultLink(resolution: AskProposalResolution): ActLink | null {
  if (resolution.kind !== "done") return null;
  if (resolution.page === "events" && resolution.id) {
    return {
      href: `/event-details?id=${encodeURIComponent(resolution.id)}`,
      label: ACT_COPY.open_event,
    };
  }
  return RESULT_LINKS[resolution.page ?? ""] ?? null;
}

/**
 * A card that ended (Paul, 2026-11-16, #5148: "we should still see it and
 * just grey it out"). Web's twin, `FinishedCard` in
 * `apps/web/components/ask/ask-proposal.tsx`, has the reasoning: the card
 * keeps its details as they stood, faded and with no controls, under one
 * line that says how it ended. Without the card as it stood, its name.
 */
function FinishedCard({
  headline,
  resolution,
  onOpen,
  styles,
}: {
  headline: string | null;
  resolution: AskProposalResolution;
  onOpen: (link: ActLink) => void;
  styles: Styles;
}) {
  const { tokens } = useFrappTheme();
  const link = resultLink(resolution);
  const shown = resolution.shown ?? null;
  const title = shown ? cardHeadline(shown) : headline;
  const done = resolution.kind === "done";
  const tone = done ? tokens.color.semantic.success : tokens.color.text.muted;
  return (
    <View style={[styles.card, styles.cardFinished]} testID="ask-card-finished">
      <View style={styles.headRow}>
        <AskCardGlyph
          name={
            done ? "done" : resolution.kind === "gone" ? "clock" : "dismissed"
          }
          color={tone}
        />
        <Text style={[styles.headText, { color: tone }]}>
          {resolutionLine(resolution)}
        </Text>
        {link ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={link.label}
            hitSlop={12}
            onPress={() => onOpen(link)}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <Text style={styles.headLink}>{link.label}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.faded}>
        {title ? (
          <Text
            style={[
              styles.headline,
              resolution.kind === "cancelled" ? styles.struck : null,
            ]}
          >
            {title}
          </Text>
        ) : null}
        {shown ? <CardDetails suggestion={shown} styles={styles} /> : null}
      </View>
    </View>
  );
}

/** What a finished card still shows under its name, as words. */
function CardDetails({
  suggestion,
  styles,
}: {
  suggestion: AiSuggestion;
  styles: Styles;
}) {
  const { points, task, new_event: event } = suggestion;
  if (event) return <EventFacts event={event} styles={styles} />;
  if (task) {
    return (
      <>
        {task.description ? (
          <Text style={styles.muted}>{task.description}</Text>
        ) : null}
        {task.due_date ? (
          <Fact glyph="clock" styles={styles}>
            {dueLine(task)}
          </Fact>
        ) : null}
      </>
    );
  }
  if (points) {
    return (
      <>
        <Fact glyph="reason" styles={styles}>
          {points.reason}
        </Fact>
        {points.event_name ? (
          <Fact glyph="people" styles={styles}>
            {actAttendanceLine(points.event_name, points.event_start_time)}
          </Fact>
        ) : null}
      </>
    );
  }
  return null;
}

/** One detail on a card: its mark, then the words, with a quieter line under. */
function Fact({
  glyph,
  under,
  children,
  styles,
}: {
  glyph: AskCardGlyphName;
  under?: string;
  children: ReactNode;
  styles: Styles;
}) {
  const { tokens } = useFrappTheme();
  return (
    <View style={styles.fact}>
      <View style={styles.factGlyph}>
        <AskCardGlyph name={glyph} color={tokens.color.text.mutedForeground} />
      </View>
      <View style={styles.factWords}>
        <Text style={styles.factText}>{children}</Text>
        {under ? <Text style={styles.caption}>{under}</Text> : null}
      </View>
    </View>
  );
}

type ProposedEvent = NonNullable<AiSuggestion["new_event"]>;

/**
 * A proposed event's details, the way a calendar invite opens: a small tile
 * with the weekday and the day, the whole date over the times, then each
 * detail on its own line with its mark.
 */
function EventFacts({
  event,
  pointsField,
  styles,
}: {
  event: ProposedEvent;
  /** The empty points field, in place of the points line, while it waits. */
  pointsField?: ReactNode;
  styles: Styles;
}) {
  const { accentPrimary } = useChapterBranding();
  const when = actWhenParts(event.start_time, event.end_time);
  const repeat = actRepeatParts(event.recurrence_rule, event.start_time);
  return (
    <>
      {when ? (
        <View style={styles.when}>
          <View
            style={styles.tile}
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={[styles.tileDay, { color: accentPrimary }]}>
              {when.weekday}
            </Text>
            <Text style={styles.tileDate}>{when.day}</Text>
          </View>
          <View style={styles.factWords}>
            <Text style={styles.whenDate}>{when.date}</Text>
            <Text style={styles.muted}>
              {when.times}
              {event.location ? ` · ${event.location}` : ""}
            </Text>
          </View>
        </View>
      ) : null}
      {repeat ? (
        <Fact glyph="repeat" under={repeat.count || undefined} styles={styles}>
          {repeat.line}
        </Fact>
      ) : null}
      <Fact glyph="people" styles={styles}>
        {event.is_mandatory
          ? ACT_COPY.everyone_required
          : ACT_COPY.everyone_optional}
      </Fact>
      {pointsField ??
        (event.point_value === null ? null : (
          <Fact
            glyph="points"
            under={actPointsFromLine(event.points_from) || undefined}
            styles={styles}
          >
            {actEventPointsLine(event.point_value, !!event.recurrence_rule)}
          </Fact>
        ))}
      {event.description ? (
        <Text style={styles.muted}>{event.description}</Text>
      ) : null}
    </>
  );
}

/**
 * The ··· in a card's corner (Paul, 2026-11-16, #5148: Cancel goes into the
 * menu): Dismiss, and Report this when it is offered. The iOS action sheet,
 * or Android's dialog, as the member sheet's menu (`member-menu.ts`).
 */
function openCardMenu(
  title: string,
  reportable: boolean,
  onDismiss: () => void,
  onReport: () => void,
) {
  const options = [
    { label: ACT_COPY.dismiss, run: onDismiss },
    ...(reportable ? [{ label: AI_REPORT_COPY.action, run: onReport }] : []),
  ];
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...options.map((option) => option.label), ACT_COPY.cancel],
        cancelButtonIndex: options.length,
        userInterfaceStyle: "dark",
      },
      (index) => options[index]?.run(),
    );
    return;
  }
  Alert.alert(
    title,
    undefined,
    options.map((option) => ({ text: option.label, onPress: option.run })),
    { cancelable: true },
  );
}

/** A card under an answer carries no notes: they come only with a typed request. */
const NO_NOTES: ActResponse["notes"] = [];

/**
 * The cards an answer came with (`answer.proposals`, #4904), stacked under
 * it, each waiting for its own Confirm. Web's twin is `AskAnswerCards` in
 * `apps/web/components/ask/ask-proposal.tsx`, and the reasoning is there. A
 * card that ended is one line in its frame; one the server no longer holds
 * says so in the same frame. While the cards are being read each holds a
 * frame of a card's usual height, so the thread does not jump.
 */
export function AskAnswerCards({
  ids,
  ended,
  onEnded,
  kept,
  onKeep,
  report,
  onOpen,
}: {
  ids: readonly string[];
  /** How each card that is no longer waiting ended, by its id. */
  ended: Readonly<Record<string, AskCardEnd>>;
  onEnded: (suggestionId: string, end: AskCardEnd) => void;
  kept: KeptTargets;
  onKeep: (suggestionId: string, targets: string[]) => void;
  report: Reporting;
  onOpen: (link: ActLink) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const waiting = useMemo(() => ids.filter((id) => !ended[id]), [ids, ended]);
  const cards = useAskCards(waiting);
  return (
    <View style={styles.block} testID="ask-answer-cards">
      {ids.map((id) => {
        const end = ended[id];
        if (end) {
          return (
            <FinishedCard
              key={id}
              headline={end.headline}
              resolution={end.resolution}
              onOpen={onOpen}
              styles={styles}
            />
          );
        }
        const suggestion = cards.byId.get(id);
        if (suggestion) {
          const headline = cardHeadline(suggestion);
          return (
            <ActCard
              key={id}
              suggestion={suggestion}
              notes={NO_NOTES}
              kept={kept[id] ?? null}
              onKeep={onKeep}
              report={report}
              onDone={(line, page, made) =>
                onEnded(id, {
                  resolution: { kind: "done", line, page, ...made },
                  headline,
                })
              }
              onCancelled={(shown) =>
                onEnded(id, {
                  resolution: { kind: "cancelled", shown },
                  headline,
                })
              }
              onGone={(shown) =>
                onEnded(id, { resolution: { kind: "gone", shown }, headline })
              }
              styles={styles}
            />
          );
        }
        if (!cards.settled) {
          // The list could not be read: the card may well still be waiting,
          // so it is not called gone. It comes back when the list is read.
          return cards.failed ? (
            <View key={id} style={styles.card}>
              <Text accessibilityRole="alert" style={styles.muted}>
                {ASK_CARDS_COPY.unread}
              </Text>
            </View>
          ) : (
            <View
              key={id}
              accessibilityState={{ busy: true }}
              style={[styles.card, styles.cardWaiting]}
            />
          );
        }
        return (
          <FinishedCard
            key={id}
            headline={null}
            resolution={{ kind: "gone" }}
            onOpen={onOpen}
            styles={styles}
          />
        );
      })}
    </View>
  );
}

function QuietButton({
  label,
  onPress,
  disabled = false,
  styles,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      // 36pt drawn against the 44pt minimum.
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quiet,
        pressed ? styles.pressed : null,
        disabled ? styles.dimmed : null,
      ]}
    >
      <Text style={styles.quietText}>{label}</Text>
    </Pressable>
  );
}

function ActAnswer({
  response,
  busy,
  kept,
  onKeep,
  report,
  onPickEvent,
  onDone,
  onCancelled,
  onGone,
  styles,
}: {
  response: ActResponse;
  /** An event pick is on its way: the choices wait. */
  busy: boolean;
  kept: KeptTargets;
  onKeep: (suggestionId: string, targets: string[]) => void;
  report: Reporting;
  onPickEvent: (eventId: string) => void;
  onDone: CardDone;
  onCancelled: (shown: AiSuggestion) => void;
  /** The proposal stopped waiting before the member decided. */
  onGone: (shown: AiSuggestion) => void;
  styles: Styles;
}) {
  if (response.status === "proposed" && response.suggestion) {
    return (
      <ActCard
        // A new proposal starts from its own members and fields.
        key={response.suggestion.id}
        suggestion={response.suggestion}
        notes={response.notes}
        kept={kept[response.suggestion.id] ?? null}
        onKeep={onKeep}
        report={report}
        onDone={onDone}
        onCancelled={onCancelled}
        onGone={onGone}
        styles={styles}
      />
    );
  }
  if (response.status === "needs_event" && response.event_choice) {
    const { events } = response.event_choice;
    if (events.length === 0) {
      return <Text style={styles.body}>{ACT_COPY.no_recent_events}</Text>;
    }
    return (
      <>
        <Text style={styles.strong}>{ACT_COPY.pick_event}</Text>
        {events.map((event) => {
          const when = actWhenLine(event.start_time, "");
          return (
            <Pressable
              key={event.id}
              accessibilityRole="button"
              accessibilityLabel={`${event.name}. ${when}`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => onPickEvent(event.id)}
              style={({ pressed }) => [
                styles.choice,
                pressed ? styles.pressed : null,
                busy ? styles.dimmed : null,
              ]}
            >
              <Text style={styles.choiceText}>{event.name}</Text>
              <Text style={styles.caption}>{when}</Text>
            </Pressable>
          );
        })}
      </>
    );
  }
  if (response.status === "no_action") {
    const labels = response.available_actions.flatMap((action) => {
      const label = actActionLabel(action);
      return label ? [label] : [];
    });
    return (
      <>
        <Text style={styles.body}>{ACT_COPY.no_action}</Text>
        {labels.length > 0 ? (
          <View>
            <Text style={styles.muted}>{ACT_COPY.no_action_can}</Text>
            {labels.map((label) => (
              <Text key={label} style={styles.muted}>
                {`• ${label}`}
              </Text>
            ))}
          </View>
        ) : null}
      </>
    );
  }
  // `unclear`. A card is never `unavailable` or `refused`: those end a turn
  // as an answer, and an event pick that may not run is an error, not a card.
  return <Text style={styles.body}>{actMissingLine(response.missing)}</Text>;
}

/** The proposal is no longer waiting: a day passed, or it was decided elsewhere. */
function isGone(error: unknown): boolean {
  return [
    "ai.suggestion.decided",
    "ai.suggestion.expired",
    "ai.suggestion.not_found",
  ].includes(codeOf(error) ?? "");
}

/** What a card reports once it was carried out. */
type CardDone = (
  line: string,
  page: string,
  made: { id?: string | null; shown?: AiSuggestion | null },
) => void;

/** What a card that ended says in its top line. */
function resolutionLine(resolution: AskProposalResolution): string {
  if (resolution.kind === "done") return resolution.line;
  return resolution.kind === "gone" ? ACT_COPY.gone : ACT_COPY.cancelled;
}

/** Why a Confirm or Cancel was refused, in words an officer can act on. */
function refusalLine(error: unknown): string {
  return (
    actConfirmRefusalLine(codeOf(error) ?? null) ??
    errorCopy(error, ACT_COPY.failed)
  );
}

/** A field on a points card under its Edit, with its label above. */
function CardField({
  label,
  hint,
  value,
  onChangeText,
  keyboardType,
  problem,
  disabled,
  styles,
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: "numbers-and-punctuation";
  problem: string | null;
  disabled: boolean;
  styles: Styles;
}) {
  const { tokens } = useFrappTheme();
  // A card is drawn in the Ask sheet and also under a question asked in a
  // channel, which is a screen: the sheet's own input throws outside a sheet.
  const inSheet = useBottomSheetInternal(true) != null;
  const Field = inSheet ? BottomSheetTextInput : TextInput;
  return (
    <View style={styles.cardRow}>
      <Text style={styles.eyebrow}>{label}</Text>
      <Field
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        accessibilityHint={hint}
        editable={!disabled}
        keyboardType={keyboardType}
        placeholderTextColor={tokens.color.text.muted}
        style={[styles.pickerField, problem ? styles.fieldProblem : null]}
      />
      {problem ? (
        <Text accessibilityRole="alert" style={styles.problem}>
          {problem}
        </Text>
      ) : hint ? (
        <Text style={styles.caption}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** The empty points field on an event card (#5148), in the row it fills. */
function PointsInput({
  value,
  onChangeText,
  disabled,
  styles,
}: {
  value: string;
  onChangeText: (text: string) => void;
  disabled: boolean;
  styles: Styles;
}) {
  const { tokens } = useFrappTheme();
  const inSheet = useBottomSheetInternal(true) != null;
  const Field = inSheet ? BottomSheetTextInput : TextInput;
  return (
    <Field
      value={value}
      onChangeText={onChangeText}
      accessibilityLabel={ACT_COPY.points_label}
      accessibilityHint={ACT_COPY.points_missing}
      editable={!disabled}
      keyboardType="number-pad"
      placeholderTextColor={tokens.color.text.muted}
      style={[styles.pickerField, styles.pointsInput]}
    />
  );
}

/** A task's due day written out, with its time when it has one. */
function dueLine(task: { due_date: string | null; due_at: string | null }) {
  const day = meetingDueLabel(task.due_date);
  if (!day || !task.due_at) return day;
  const at = new Date(task.due_at);
  if (Number.isNaN(at.getTime())) return day;
  return `${day}, ${at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function ActCard({
  suggestion,
  notes,
  kept,
  onKeep,
  report,
  onDone,
  onCancelled,
  onGone,
  styles,
}: {
  suggestion: AiSuggestion;
  notes: ActResponse["notes"];
  /** The members the officer left on this card, or null for the proposal's own. */
  kept: readonly string[] | null;
  onKeep: (suggestionId: string, targets: string[]) => void;
  report: Reporting;
  onDone: CardDone;
  /** Dismissed: the card as it stood, to stay in place greyed. */
  onCancelled: (shown: AiSuggestion) => void;
  /** The proposal stopped waiting before the member decided. */
  onGone: (shown: AiSuggestion) => void;
  styles: Styles;
}) {
  const { tokens } = useFrappTheme();
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const accept = useAcceptAiSuggestion();
  const dismiss = useDismissAiSuggestion();
  const rosterQuery = useChapterRoster();
  const me = (useCurrentUser().data as { id?: string } | undefined)?.id ?? null;
  const roster = useMemo(
    () =>
      (rosterQuery.data ?? []).map((row) => ({
        userId: row.user_id,
        name: row.display_name.trim().length > 0 ? row.display_name : null,
      })),
    [rosterQuery.data],
  );
  const nameOf = (userId: string) => {
    const member = roster.find((row) => row.userId === userId);
    if (member) return member.name ?? memberFallbackLabel(userId);
    // Until the roster is read, a blank; after, whoever is not on it left.
    return rosterQuery.isSuccess ? ACT_COPY.former_member : "";
  };

  const { points, task, new_event: event } = suggestion;
  const proposed = points?.target_user_ids;
  const targets = useMemo(
    () => [...(kept ?? proposed ?? [])],
    [kept, proposed],
  );
  const setTargets = (change: (list: string[]) => string[]) =>
    onKeep(suggestion.id, change(targets));
  // A Confirm or Cancel is out: the card's controls wait for it.
  const [deciding, setDeciding] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  // Confirm pressed with nobody left: say so, on the card.
  const [flagged, setFlagged] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const formRef = useRef<BottomSheetModal>(null);
  // The event form mounts on the first Edit and stays, so what the officer
  // typed is still there when they open it again (#4593).
  const [eventFormMounted, setEventFormMounted] = useState(false);
  const eventFormRef = useRef<BottomSheetModal>(null);
  useEffect(() => {
    if (eventFormMounted) eventFormRef.current?.present();
  }, [eventFormMounted]);
  // A points card's Edit: its amount and reason as fields.
  const [editingPoints, setEditingPoints] = useState(false);
  const [amountInput, setAmountInput] = useState(
    points ? String(points.amount) : "",
  );
  const [reasonInput, setReasonInput] = useState(points?.reason ?? "");
  const [fieldProblem, setFieldProblem] = useState<{
    field: "amount" | "reason" | "eventPoints";
    error: string;
  } | null>(null);
  // An event's points when nobody said them and nothing matched (#5148).
  const [eventPoints, setEventPoints] = useState("");
  const typedEventPoints = actEventPointsInput(eventPoints);
  const needsPoints = !!event && event.point_value === null;
  const shownAmount = useMemo(() => {
    if (!points || !editingPoints) return points?.amount ?? 0;
    // The amount alone: a reason not yet written says nothing about it.
    const read = actPointsEdits(points, amountInput, "-");
    return read.ok ? (read.edits.amount ?? points.amount) : points.amount;
  }, [points, editingPoints, amountInput]);
  const pickerRef = useRef<BottomSheetModal>(null);
  useEffect(() => {
    if (formOpen) formRef.current?.present();
  }, [formOpen]);
  const busy = accept.isPending || dismiss.isPending || deciding;

  const noteLines = notes.flatMap((note) => {
    const line = actNoteLine({
      type: note.type,
      name: note.name ?? null,
      count: note.count ?? null,
      matched:
        note.type === "matched_name" && note.user_ids?.[0]
          ? nameOf(note.user_ids[0]) || null
          : null,
    });
    return line ? [line] : [];
  });

  async function confirm() {
    setProblem(null);
    let edits: { points?: PointsSuggestionEdits; newEventPoints?: number } = {};
    if (points) {
      if (targets.length === 0) {
        setFlagged(true);
        return;
      }
      const changes: PointsSuggestionEdits = {};
      if (editingPoints) {
        const read = actPointsEdits(points, amountInput, reasonInput);
        if (!read.ok) {
          setFieldProblem({ field: read.field, error: read.error });
          return;
        }
        Object.assign(changes, read.edits);
      }
      const changed =
        targets.length !== points.target_user_ids.length ||
        targets.some((id) => !points.target_user_ids.includes(id));
      if (changed) changes.target_user_ids = targets;
      if (Object.keys(changes).length > 0) edits = { points: changes };
    }
    if (task && (!task.assignee_id || !task.due_date)) {
      // A task needs who and when; the form is where the officer says them.
      setFormOpen(true);
      return;
    }
    if (needsPoints) {
      const read = actEventPointsInput(eventPoints);
      if (!read.ok) {
        setFieldProblem({ field: "eventPoints", error: read.error });
        return;
      }
      edits = { newEventPoints: read.value };
    }
    setDeciding(true);
    try {
      const decision = await accept.mutateAsync({
        id: suggestion.id,
        ...edits,
      });
      const shown: AiSuggestion = {
        ...suggestion,
        points: points
          ? {
              ...points,
              target_user_ids: targets,
              amount: edits.points?.amount ?? points.amount,
              reason: edits.points?.reason ?? points.reason,
            }
          : points,
        new_event:
          event && edits.newEventPoints !== undefined
            ? { ...event, point_value: edits.newEventPoints, points_from: null }
            : event,
      };
      if (points) {
        const outcome = decision.result?.outcome;
        onDone(
          actPointsDoneLine(
            edits.points?.amount ?? points.amount,
            outcome?.adjusted ?? targets.length,
            outcome?.skipped ?? 0,
          ),
          "points",
          { shown },
        );
      } else if (task) {
        onDone(ACT_COPY.done_task, "tasks", { shown });
      } else {
        onDone(ACT_COPY.done_event, "events", {
          id: decision.result?.id ?? null,
          shown,
        });
      }
    } catch (error) {
      // A card that stopped waiting says so in its place, with no buttons.
      if (isGone(error)) onGone(suggestion);
      else setProblem(refusalLine(error));
    } finally {
      setDeciding(false);
    }
  }

  async function cancel() {
    setProblem(null);
    setDeciding(true);
    try {
      await dismiss.mutateAsync(suggestion.id);
    } catch (error) {
      // Already decided elsewhere: it may have been confirmed, so the card
      // does not say cancelled.
      if (codeOf(error) === "ai.suggestion.decided") {
        onGone(suggestion);
        return;
      }
      // Already gone is what Cancel wanted.
      if (!isGone(error)) {
        setProblem(refusalLine(error));
        return;
      }
    } finally {
      setDeciding(false);
    }
    onCancelled(suggestion);
  }

  /** Edit: the form the officer already uses, or a points card's fields. */
  function edit() {
    setProblem(null);
    if (event) {
      if (eventFormMounted) eventFormRef.current?.present();
      else setEventFormMounted(true);
    } else if (task) {
      setFormOpen(true);
    } else if (points) {
      setEditingPoints(true);
    }
  }

  // Create in the event form is the confirm: the form made the event through
  // its own route, and the proposal records it (or is taken down). The event
  // is made either way, so the card says so either way. What the form made
  // is the form's, so the finished card keeps only its name.
  async function recordMadeEvent(eventId: string | null) {
    setDeciding(true);
    await settleProposedEvent({ accept, dismiss }, suggestion.id, eventId);
    setDeciding(false);
    onDone(ACT_COPY.done_event, "events", { id: eventId });
  }

  const addable = roster.filter(
    (member) => member.userId !== me && !targets.includes(member.userId),
  );

  let title: string = ACT_COPY.card_event_title;
  let glyph: AskCardGlyphName = "event";
  let action: string = ACT_COPY.create_event;
  if (points) {
    title =
      shownAmount < 0
        ? ACT_COPY.card_points_title_take
        : ACT_COPY.card_points_title_give;
    glyph = "points";
    action = actPointsAction(shownAmount);
  } else if (task) {
    title = ACT_COPY.card_task_title;
    glyph = "task";
    action = ACT_COPY.create_task;
  }

  // Above the controls it points at ("Add them below").
  const notesStrip =
    noteLines.length > 0 ? (
      <View style={styles.notes}>
        {noteLines.map((line) => (
          <Text key={line} style={styles.noteLine}>
            {line}
          </Text>
        ))}
      </View>
    ) : null;

  const reportTarget = {
    subject: "ai_suggestion" as const,
    subjectId: suggestion.id,
  };
  const reported = report.offered && report.isReported(reportTarget);
  const membersOpen = showMembers || targets.length <= 5;

  const seed: TaskSuggestionSeed | undefined = task
    ? {
        title: task.title,
        assigneeId: task.assignee_id,
        dueDay: task.due_date,
        dueAt: task.due_at,
        subtasks: task.subtasks,
        accept: async (form) => {
          setDeciding(true);
          try {
            await accept.mutateAsync({
              id: suggestion.id,
              task: suggestionEdits(task, form),
            });
          } finally {
            setDeciding(false);
          }
          // Who and when are the form's; the card keeps its name.
          onDone(ACT_COPY.done_task, "tasks", {});
        },
      }
    : undefined;

  const pointsMissing = fieldProblem?.field === "eventPoints";
  const eventPointsField = needsPoints ? (
    <View style={[styles.ask, pointsMissing ? styles.askProblem : null]}>
      <View style={styles.fact}>
        <View style={styles.factGlyph}>
          <AskCardGlyph
            name="points"
            color={tokens.color.text.mutedForeground}
          />
        </View>
        <Text style={[styles.factText, styles.factWords]}>
          {ACT_COPY.points_label}
        </Text>
        <PointsInput
          value={eventPoints}
          onChangeText={(text) => {
            setEventPoints(text);
            if (pointsMissing) setFieldProblem(null);
          }}
          disabled={busy}
          styles={styles}
        />
      </View>
      <Text
        accessibilityRole={pointsMissing ? "alert" : undefined}
        style={pointsMissing ? styles.problem : styles.askHint}
      >
        {pointsMissing ? fieldProblem.error : ACT_COPY.points_missing}
      </Text>
    </View>
  ) : null;

  return (
    <View accessibilityLabel={title} style={styles.card}>
      <View style={styles.headRow}>
        <AskCardGlyph name={glyph} color={tokens.color.text.mutedForeground} />
        <Text style={styles.headText}>{title}</Text>
        {/* Dismiss, and Report this (#4315) for the Frapp team (#5148). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${ACT_COPY.more}: ${title}`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          hitSlop={10}
          onPress={() =>
            openCardMenu(
              title,
              report.offered && !reported,
              () => void cancel(),
              () => report.report(reportTarget),
            )
          }
          style={({ pressed }) => [
            styles.more,
            pressed ? styles.pressed : null,
          ]}
        >
          <OverflowGlyph color={tokens.color.text.mutedForeground} size={20} />
        </Pressable>
      </View>

      {points ? (
        <>
          <View>
            <Text style={styles.headline}>
              {actPointsHeadline(shownAmount, targets.length)}
            </Text>
            {/* One line high with or without it, so removing down to one
                member moves nothing. */}
            <Text style={[styles.caption, styles.oneLine]}>
              {actPointsTotalLine(shownAmount, targets.length)}
            </Text>
          </View>
          {editingPoints ? (
            <>
              <CardField
                label={ACT_COPY.field_amount}
                hint={ACT_COPY.amount_hint}
                value={amountInput}
                onChangeText={(text) => {
                  setAmountInput(text);
                  if (fieldProblem?.field === "amount") setFieldProblem(null);
                }}
                keyboardType="numbers-and-punctuation"
                problem={
                  fieldProblem?.field === "amount" ? fieldProblem.error : null
                }
                disabled={busy}
                styles={styles}
              />
              <CardField
                label={ACT_COPY.field_reason}
                value={reasonInput}
                onChangeText={(text) => {
                  setReasonInput(text);
                  if (fieldProblem?.field === "reason") setFieldProblem(null);
                }}
                problem={
                  fieldProblem?.field === "reason" ? fieldProblem.error : null
                }
                disabled={busy}
                styles={styles}
              />
            </>
          ) : (
            <Fact glyph="reason" styles={styles}>
              {points.reason}
            </Fact>
          )}
          {points.event_name ? (
            <Fact glyph="people" styles={styles}>
              {actAttendanceLine(points.event_name, points.event_start_time)}
            </Fact>
          ) : null}
          {notesStrip}
          {targets.length > 0 ? (
            <View style={styles.cardRow}>
              <View style={styles.cardHead}>
                <Text style={styles.eyebrow}>{ACT_COPY.field_members}</Text>
                {targets.length > 5 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: membersOpen }}
                    hitSlop={12}
                    onPress={() => setShowMembers((shown) => !shown)}
                    style={({ pressed }) => (pressed ? styles.pressed : null)}
                  >
                    <Text style={styles.captionStrong}>
                      {membersOpen
                        ? ACT_COPY.hide_members
                        : ACT_COPY.show_members}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {membersOpen ? (
                <View style={styles.members}>
                  {targets.map((userId, index) => {
                    const name = nameOf(userId);
                    return (
                      <View
                        key={userId}
                        style={[
                          styles.member,
                          index > 0 ? styles.memberDivided : null,
                        ]}
                      >
                        <Text numberOfLines={1} style={styles.memberName}>
                          {name}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${ACT_COPY.remove_member} ${name}`}
                          accessibilityState={{ disabled: busy }}
                          disabled={busy}
                          onPress={() =>
                            setTargets((list) =>
                              list.filter((other) => other !== userId),
                            )
                          }
                          style={({ pressed }) => [
                            styles.remove,
                            pressed ? styles.pressed : null,
                          ]}
                        >
                          <CloseGlyph
                            size={14}
                            color={tokens.color.text.mutedForeground}
                          />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}
          {addable.length > 0 ? (
            <QuietButton
              label={ACT_COPY.add_member}
              disabled={busy}
              onPress={() => pickerRef.current?.present()}
              styles={styles}
            />
          ) : null}
          {flagged && targets.length === 0 ? (
            <Text accessibilityRole="alert" style={styles.problem}>
              {ACT_COPY.no_members}
            </Text>
          ) : null}
        </>
      ) : null}

      {task ? (
        <>
          <Text style={styles.headline}>{task.title}</Text>
          {task.description ? (
            <Text style={styles.muted}>{task.description}</Text>
          ) : null}
          {notesStrip}
          {/* Who and when open the task form on this proposal, where an
              officer already sets them. */}
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the task form to change it."
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => setFormOpen(true)}
            style={({ pressed }) => [
              styles.taskFields,
              pressed ? styles.pressed : null,
            ]}
          >
            <View
              style={[styles.chipRow, task.assignee_id ? null : styles.ask]}
            >
              <View style={styles.factGlyph}>
                <AskCardGlyph
                  name="person"
                  color={tokens.color.text.mutedForeground}
                />
              </View>
              <Text style={task.assignee_id ? styles.factText : styles.missing}>
                {task.assignee_id
                  ? nameOf(task.assignee_id)
                  : ACT_COPY.pick_member}
              </Text>
            </View>
            <View style={[styles.chipRow, task.due_date ? null : styles.ask]}>
              <View style={styles.factGlyph}>
                <AskCardGlyph
                  name="clock"
                  color={tokens.color.text.mutedForeground}
                />
              </View>
              <Text style={task.due_date ? styles.factText : styles.missing}>
                {task.due_date ? dueLine(task) : ACT_COPY.pick_due}
              </Text>
            </View>
          </Pressable>
        </>
      ) : null}

      {event ? (
        <>
          <Text style={styles.headline}>{event.name}</Text>
          <EventFacts
            event={event}
            pointsField={eventPointsField}
            styles={styles}
          />
        </>
      ) : null}

      <Text style={styles.caption}>
        {ACT_COPY.mine_only}{" "}
        {points
          ? ACT_COPY.points_push
          : task
            ? ACT_COPY.task_push
            : ACT_COPY.event_push}
      </Text>

      {problem ? (
        <Text accessibilityRole="alert" style={styles.problem}>
          {problem}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {editingPoints ? null : (
          <QuietButton
            label={ACT_COPY.edit}
            disabled={busy}
            onPress={edit}
            styles={styles}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          accessibilityState={{ disabled: busy, busy: accept.isPending }}
          disabled={busy}
          hitSlop={4}
          onPress={() => void confirm()}
          style={({ pressed }) => [
            styles.confirm,
            { backgroundColor: accentPrimary },
            pressed ? styles.pressed : null,
            busy ? styles.dimmed : null,
          ]}
        >
          {/* The same word while it saves, so the button keeps its width. */}
          <Text style={[styles.confirmText, { color: accentOnPrimary }]}>
            {action}
          </Text>
        </Pressable>
      </View>

      {points ? (
        <MemberPickerSheet
          ref={pickerRef}
          members={addable}
          loading={rosterQuery.isPending}
          onPick={(userId) => {
            setTargets((list) =>
              list.includes(userId) ? list : [...list, userId],
            );
            setFlagged(false);
          }}
        />
      ) : null}
      {event && eventFormMounted ? (
        <NewEventSheet
          ref={eventFormRef}
          template={proposedEventTemplate({
            ...event,
            // Points typed on the card go with it into the form (#5148).
            point_value:
              event.point_value ??
              (typedEventPoints.ok ? typedEventPoints.value : null),
          })}
          onCreated={(created) => void recordMadeEvent(created.id)}
        />
      ) : null}
      {formOpen && seed ? (
        <NewTaskSheet
          ref={formRef}
          suggestion={seed}
          onClosed={() => setFormOpen(false)}
        />
      ) : null}
    </View>
  );
}

interface PickerMember {
  userId: string;
  name: string | null;
}

/**
 * The roster to add one member from: a tall sheet with a search field
 * (`components.md` § Surface size), as the task form's "Assign to" is. A
 * pick closes it.
 */
const MemberPickerSheet = forwardRef<
  BottomSheetModal,
  {
    members: readonly PickerMember[];
    loading: boolean;
    onPick: (userId: string) => void;
  }
>(function MemberPickerSheet({ members, loading, onPick }, ref) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const tall = useTallSheetProps();
  const close = useSheetClose(ref);
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const named = members.map((member) => ({
      userId: member.userId,
      label: member.name ?? memberFallbackLabel(member.userId),
    }));
    return needle
      ? named.filter((member) => member.label.toLowerCase().includes(needle))
      : named;
  }, [members, search]);

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tall}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => setSearch("")}
    >
      <SheetBackToClose onClose={close} />
      <BottomSheetFlatList
        onAccessibilityEscape={close}
        data={shown}
        keyExtractor={(row: { userId: string; label: string }) => row.userId}
        contentContainerStyle={styles.pickerContent}
        keyboardShouldPersistTaps="handled"
        // The title and search stay pinned while the roster scrolls.
        stickyHeaderIndices={[0]}
        ListHeaderComponent={
          <View style={styles.pickerHeader}>
            <TallSheetHeader title={ACT_COPY.add_member} onClose={close} />
            <BottomSheetTextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search members"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Search members"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.pickerField}
            />
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.pickerEmpty}>
            {loading
              ? "Loading your chapter…"
              : "No members match that search."}
          </Text>
        }
        renderItem={({ item }: { item: { userId: string; label: string } }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={() => {
              onPick(item.userId);
              close();
            }}
            style={({ pressed }) => [
              styles.pickerRow,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text numberOfLines={1} style={styles.body}>
              {item.label}
            </Text>
          </Pressable>
        )}
      />
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  const caption = typeRole(tokens.typography.role.caption);
  const gold = tokens.color.gold;
  return StyleSheet.create({
    block: {
      gap: tokens.spacing.sm,
      alignItems: "stretch",
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    strong: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    muted: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    caption: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
    captionStrong: {
      ...caption,
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.mutedForeground,
    },
    oneLine: {
      minHeight: caption.lineHeight ?? 18,
    },
    eyebrow: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.mutedForeground,
    },
    choice: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    choiceText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    quiet: {
      height: 36,
      alignSelf: "flex-start",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      // One step above the card it sits in (`lib/surfaces.ts`): on the card's
      // own fill only the border said it was a button.
      backgroundColor: tokens.color.surface.card,
    },
    quietText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      padding: tokens.spacing.md,
      gap: tokens.spacing.md,
    },
    // A card still being read: its frame, at about a card's height.
    cardWaiting: {
      height: 112,
      opacity: 0.6,
    },
    cardHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    cardRow: {
      gap: tokens.spacing.xs,
    },
    headline: {
      ...typeRole(tokens.typography.role.body),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    notes: {
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.surface.card,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      gap: tokens.spacing.xs,
    },
    noteLine: {
      ...caption,
      color: tokens.color.text.foreground,
    },
    members: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    member: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: tokens.touch.minimum,
      paddingLeft: tokens.spacing.md,
    },
    memberDivided: {
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
    },
    memberName: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    remove: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    taskFields: {
      gap: tokens.spacing.md,
    },
    missing: {
      ...typeRole(tokens.typography.role.body),
      color: gold.askText,
    },
    problem: {
      ...caption,
      color: tokens.color.semantic.destructiveText,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: tokens.spacing.sm,
    },
    confirm: {
      height: 36,
      minWidth: 88,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      // The fill and the word's colour are the chapter's solid accent pair,
      // set where the button is drawn.
    },
    confirmText: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
    },
    pickerContent: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
    },
    pickerHeader: {
      backgroundColor: tokens.color.surface.popover,
      paddingBottom: tokens.spacing.sm,
      gap: tokens.spacing.sm,
    },
    pickerField: {
      ...sheetFieldStyles(tokens, gold.house).field,
    },
    pickerRow: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    pickerEmpty: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingVertical: tokens.spacing.lg,
    },
    fieldProblem: {
      borderColor: tokens.color.semantic.destructive,
    },
    // The card's top line: its kind's mark, its kind, and the ··· (#5148).
    headRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: 24,
    },
    headText: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.mutedForeground,
      flex: 1,
    },
    headLink: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    more: {
      width: 32,
      height: 24,
      alignItems: "flex-end",
      justifyContent: "center",
    },
    fact: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.sm,
    },
    factGlyph: {
      paddingTop: 2,
    },
    factWords: {
      flex: 1,
      minWidth: 0,
    },
    factText: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(400),
      color: tokens.color.text.foreground,
    },
    when: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    tile: {
      width: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      alignItems: "center",
      paddingVertical: 4,
    },
    tileDay: {
      ...caption,
      fontSize: 10.5,
      lineHeight: 13,
      fontFamily: fontFamilyFor(700),
      letterSpacing: 0.6,
    },
    tileDate: {
      ...typeRole(tokens.typography.role.title),
      lineHeight: 22,
      color: tokens.color.text.foreground,
    },
    whenDate: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    // What the card still needs from the member: outlined, never guessed.
    ask: {
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: tokens.color.semantic.warning,
      backgroundColor: "rgba(229,160,0,0.07)",
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
      gap: tokens.spacing.xs,
    },
    askProblem: {
      borderColor: tokens.color.semantic.destructive,
    },
    askHint: {
      ...caption,
      color: gold.askText,
    },
    pointsInput: {
      width: 72,
      height: 32,
      paddingVertical: 0,
      textAlign: "right",
    },
    chipRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: 32,
    },
    cardFinished: {
      backgroundColor: tokens.color.surface.background,
    },
    faded: {
      opacity: 0.5,
      gap: tokens.spacing.md,
    },
    struck: {
      textDecorationLine: "line-through",
    },
    pressed: { opacity: 0.7 },
    dimmed: { opacity: 0.5 },
  });
}
