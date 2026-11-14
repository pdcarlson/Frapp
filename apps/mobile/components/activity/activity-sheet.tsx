import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  NavigationContext,
  NavigationRouteContext,
} from "expo-router/react-navigation";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import {
  activityEventMessage,
  activityHoursMessage,
  activityTaskMessage,
} from "@repo/chat-core/activity-cards";
import {
  readEventPayload,
  readHoursPayload,
  readTaskPayload,
} from "@repo/chat-core/cards";
import type { ChatMessage } from "@repo/chat-core/types";
import { useReviewServiceEntry, type ActivityRow } from "@repo/hooks";
import {
  MESSAGE_REMINDER_PRESETS,
  messageReminderPresetTime,
  type MessageReminderPresetId,
} from "@repo/hooks/use-message-reminders";
import { SignetTokens } from "@repo/theme/signet";
import {
  CardActions,
  CardButton,
  CardNote,
  type ChatCardFrameProps,
} from "@/components/chat/chat-card";
import { EventCard } from "@/components/chat/event-card";
import { ListRow, ListSection } from "@/components/list-section";
import { HoursCard } from "@/components/chat/hours-card";
import { PollCard } from "@/components/chat/poll-card";
import { TaskCard } from "@/components/chat/task-card";
import {
  SheetBackToClose,
  SheetGrabber,
  SHEET_STACK_BEHAVIOR,
  SheetScrim,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import {
  hoursReviewFailure,
  type ActivityRowActionState,
} from "@/lib/activity/row-action";
import { useActivityPoll } from "@/lib/activity/use-activity-poll";
import { confirmClosePoll } from "@/lib/chat/confirm-close-poll";
import {
  reminderAtLabel,
  reminderPresetValue,
} from "@/lib/chat/message-reminder";
import { useConnection } from "@/lib/connection/use-connection";
import { typeRole, useFrappTheme } from "@/lib/theme";

type RowOf<K extends ActivityRow["kind"]> = Extract<ActivityRow, { kind: K }>;

/**
 * What a sign-up link's sheet can do. The screen owns these, not the sheet:
 * Done, Hide and Remove take the row off the list at once, which closes the
 * sheet, and the "Undo" bar that follows has to outlive it.
 */
export interface LinkSheetActions {
  canRemove: boolean;
  open: (row: RowOf<"link">) => void;
  done: (row: RowOf<"link">) => void;
  hide: (row: RowOf<"link">) => void;
  openInChat: (row: RowOf<"link">) => void;
  remove: (row: RowOf<"link">) => void;
}

/**
 * What a message reminder's sheet can do (#4957), the screen's as a link's
 * are: Done takes the row off the list at once, and opening the message
 * leaves the screen.
 */
export interface ReminderSheetActions {
  open: (row: RowOf<"reminder">) => void;
  snooze: (row: RowOf<"reminder">, preset: MessageReminderPresetId) => void;
  done: (row: RowOf<"reminder">) => void;
}

const noop = () => {};

/**
 * What every card takes from a thread row, for a card drawn outside one:
 * nothing to retry or discard (the message is not being sent), no reactions
 * and no message actions, which belong to the message in its channel.
 */
function frameFor(message: ChatMessage, viewerId: string): ChatCardFrameProps {
  return {
    message,
    viewerId,
    isConfirmed: true,
    onRetry: noop,
    onDiscard: noop,
    onReact: noop,
    onUnreact: noop,
  };
}

/**
 * The sheet an Activity row opens: the record, drawn with the card chat draws
 * for it, so a member votes, marks a task done, confirms it or checks in here
 * with the controls they already know from chat (#3897). Web's twin is
 * `apps/web/components/activity/activity-panel.tsx`.
 *
 * The cards are chat's own components, unchanged. Each reads its record's
 * live state by id and its buttons call the same routes they call in chat.
 * Two things are added under them, because the cards do not carry them:
 * - a poll gets "Open in chat", which opens the channel the poll lives in;
 * - a pending service entry gets Approve and Reject. Chat's hours card is a
 *   read-only record, and the phone has no other screen that reviews hours.
 *
 * A sign-up link has no chat card: its sheet is `LinkSheet` below, the link
 * and the screen's own actions for it (`LinkSheetActions`).
 *
 * A tall sheet, as `spec/ui/mobile/patterns.md` § Bottom sheets gives a sheet
 * that holds a whole record. A sheet is drawn outside the screen's
 * navigator, so the screen's navigation context is handed down to the cards:
 * their refusals clear when the member comes back to this screen
 * (`useCardWrite`), as they do in a thread.
 *
 * `onActed` runs after an action this sheet makes itself (a vote, a review),
 * so the row can leave its list; `onClosed` runs when the sheet has gone,
 * which is when the screen re-reads for what the cards' own buttons changed
 * and lets go of `row`. Until then the screen keeps handing the row down, so
 * the card stays drawn while the sheet slides away.
 */
export function ActivitySheet({
  row,
  viewerId,
  rowActionState = "idle",
  onClosed,
  onActed,
  linkActions,
  reminderActions,
}: {
  row: ActivityRow | null;
  viewerId: string | null;
  /**
   * Where the row's own Confirm, Approve or Check in stands (#4437, #4427), so the sheet
   * opened from that row doesn't offer the same approval a second time.
   */
  rowActionState?: ActivityRowActionState;
  onClosed: () => void;
  onActed: () => void;
  linkActions: LinkSheetActions;
  reminderActions: ReminderSheetActions;
}) {
  const sheet = useRef<BottomSheetModal>(null);
  const closeSheet = useSheetClose(sheet);
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);

  // Presented once per row opened, not on every re-read that hands the same
  // row down as a new object.
  const openKey = row?.key ?? null;
  useEffect(() => {
    if (openKey !== null) sheet.current?.present();
  }, [openKey]);

  return (
    <BottomSheetModal
      ref={sheet}
      {...tallSheet}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={onClosed}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        style={styles.scroll}
        contentContainerStyle={styles.body}
        stickyHeaderIndices={[0]}
      >
        <View style={styles.stickyHeader}>
          <TallSheetHeader onClose={closeSheet} />
        </View>
        <NavigationContext.Provider value={navigation}>
          <NavigationRouteContext.Provider value={route}>
            {row && viewerId ? (
              <SheetCard
                // A different row is a different card: no state carries over.
                key={row.key}
                row={row}
                viewerId={viewerId}
                rowActionState={rowActionState}
                onActed={onActed}
                onNavigate={closeSheet}
                linkActions={linkActions}
                reminderActions={reminderActions}
              />
            ) : row ? (
              // The cards decide whose controls to show from the viewer's id;
              // without it they would show none, or the wrong ones.
              <CardNote text="Loading your account…" />
            ) : null}
          </NavigationRouteContext.Provider>
        </NavigationContext.Provider>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

function SheetCard({
  row,
  viewerId,
  rowActionState,
  onActed,
  onNavigate,
  linkActions,
  reminderActions,
}: {
  row: ActivityRow;
  viewerId: string;
  rowActionState: ActivityRowActionState;
  onActed: () => void;
  /** Closes the sheet before leaving this screen for another. */
  onNavigate: () => void;
  linkActions: LinkSheetActions;
  reminderActions: ReminderSheetActions;
}) {
  switch (row.kind) {
    case "task":
      return <TaskSheet row={row} viewerId={viewerId} />;
    case "event":
      return (
        <EventSheet row={row} viewerId={viewerId} onNavigate={onNavigate} />
      );
    case "poll":
      return (
        <PollSheet row={row} viewerId={viewerId} onNavigate={onNavigate} />
      );
    case "hours":
      return (
        <HoursSheet
          row={row}
          viewerId={viewerId}
          rowActionState={rowActionState}
          onActed={onActed}
        />
      );
    case "link":
      return (
        <LinkSheet row={row} actions={linkActions} onNavigate={onNavigate} />
      );
    case "reminder":
      return (
        <ReminderSheet
          row={row}
          actions={reminderActions}
          onNavigate={onNavigate}
        />
      );
    case "card":
      // A sign-up or form row opens its message in chat, never this sheet.
      return null;
  }
}

/** Said where a reminder's message can't be opened any more. */
export const REMINDER_UNAVAILABLE_NOTE =
  "You can't see this conversation any more, so the message can't be opened.";

/**
 * A reminder on a chat message (#4957): the message's words, who wrote it,
 * where and when it was for, as the row says, then what Slack's Later list
 * offers on one: open the message, Done, or Snooze to a preset (the same ones
 * the message menu sets it with). Every button closes the sheet first. A
 * message the member can no longer read is only cleared.
 */
function ReminderSheet({
  row,
  actions,
  onNavigate,
}: {
  row: RowOf<"reminder">;
  actions: ReminderSheetActions;
  onNavigate: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createLinkStyles(tokens);
  // Read once per sheet: the presets' times as they stood when it opened.
  const [now] = useState(() => new Date());
  const then = (action: () => void) => () => {
    onNavigate();
    action();
  };
  const available = row.reminder.message_available;
  return (
    <>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          {row.title}
        </Text>
        {row.detail ? <Text style={styles.detail}>{row.detail}</Text> : null}
      </View>
      {available ? null : <CardNote text={REMINDER_UNAVAILABLE_NOTE} />}
      <CardActions>
        {available ? (
          <CardButton
            label="Open message"
            variant="primary"
            accessibilityHint={
              row.reminder.thread_root_id
                ? "Opens the thread, at the message."
                : "Opens the conversation, at the message."
            }
            onPress={then(() => actions.open(row))}
          />
        ) : null}
        <CardButton
          label="Done"
          accessibilityHint="Clears the reminder and takes it off your Activity."
          onPress={then(() => actions.done(row))}
        />
      </CardActions>
      {available ? (
        <View style={styles.head}>
          {/* Slack's word for a reminder whose time came; one still to
              come is only moved. */}
          <Text style={styles.detail}>
            {row.reminder.due ? "Snooze" : "Change the time"}
          </Text>
          <ListSection>
            {MESSAGE_REMINDER_PRESETS.map((preset) => {
              const at = messageReminderPresetTime(preset.id, now);
              return (
                <ListRow
                  key={preset.id}
                  label={preset.label}
                  value={reminderPresetValue(at, now)}
                  action
                  accessibilityHint={`Reminds you ${reminderAtLabel(at, now)}.`}
                  onPress={then(() => actions.snooze(row, preset.id))}
                />
              );
            })}
          </ListSection>
        </View>
      ) : null}
    </>
  );
}

/**
 * A sign-up link (`spec/behavior/activity.md` § Links): what it is, who
 * posted it where, and the address, so the member sees where it goes before
 * opening it. "Open link" opens it in the in-app browser, as a link tapped in
 * chat does. Every other button closes the sheet first.
 */
function LinkSheet({
  row,
  actions,
  onNavigate,
}: {
  row: RowOf<"link">;
  actions: LinkSheetActions;
  onNavigate: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createLinkStyles(tokens);
  const then = (action: (row: RowOf<"link">) => void) => () => {
    onNavigate();
    action(row);
  };
  return (
    <>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          {row.title}
        </Text>
        {row.detail ? <Text style={styles.detail}>{row.detail}</Text> : null}
        <Text style={styles.url} numberOfLines={2} selectable>
          {row.link.url}
        </Text>
      </View>
      <CardActions>
        <CardButton
          label="Open link"
          variant="primary"
          accessibilityHint="Opens the form in the browser."
          onPress={() => actions.open(row)}
        />
        <CardButton
          label="Done"
          accessibilityHint="You filled it in. Takes it off your Activity."
          onPress={then(actions.done)}
        />
      </CardActions>
      <CardActions>
        <CardButton
          label="Hide"
          accessibilityHint="Not chapter business. Takes it off your Activity."
          onPress={then(actions.hide)}
        />
        <CardButton
          label="Open in chat"
          accessibilityHint={
            row.link.thread_root_id
              ? "Opens the thread it was posted in."
              : "Opens the channel it was posted in."
          }
          onPress={then(actions.openInChat)}
        />
      </CardActions>
      {actions.canRemove ? (
        <CardActions>
          <CardButton
            label="Remove for everyone"
            accessibilityHint="Takes it off every member's Activity. The message stays in chat."
            onPress={then(actions.remove)}
          />
        </CardActions>
      ) : null}
    </>
  );
}

function createLinkStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    head: {
      gap: tokens.spacing.xs,
    },
    title: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.foreground,
    },
    detail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    url: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}

function TaskSheet({
  row,
  viewerId,
}: {
  row: RowOf<"task">;
  viewerId: string;
}) {
  const message = useMemo(() => activityTaskMessage(row.task), [row.task]);
  const payload = readTaskPayload(message);
  return payload ? (
    <TaskCard {...frameFor(message, viewerId)} payload={payload} />
  ) : null;
}

function EventSheet({
  row,
  viewerId,
  onNavigate,
}: {
  row: RowOf<"event">;
  viewerId: string;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const message = useMemo(() => activityEventMessage(row.event), [row.event]);
  const payload = readEventPayload(message);
  if (!payload) return null;
  return (
    <>
      <EventCard
        {...frameFor(message, viewerId)}
        payload={payload}
        onNavigate={onNavigate}
      />
      <CardActions>
        <CardButton
          label="Open event"
          accessibilityHint="Opens the event's page."
          onPress={() => {
            onNavigate();
            // Object form: the shape `lib/routes.spec.ts` matches when a
            // param is involved.
            router.push({
              pathname: "/event-details",
              params: { id: row.event.id },
            });
          }}
        />
      </CardActions>
    </>
  );
}

function PollSheet({
  row,
  viewerId,
  onNavigate,
}: {
  row: RowOf<"poll">;
  viewerId: string;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const poll = useActivityPoll(row.poll);
  return (
    <>
      <PollCard
        {...frameFor(poll.message, viewerId)}
        // No vote until the votes are read: the card decides "have I voted"
        // from them, and a tally drawn from nothing would read as zero.
        isConfirmed={!poll.votesLoading && !poll.votesFailed}
        onVote={(messageId, actionType, payload) =>
          void poll.vote(messageId, actionType, payload)
        }
        onClosePoll={(messageId) =>
          confirmClosePoll(() => poll.close(messageId))
        }
      />
      {poll.votesFailed ? (
        <CardNote
          tone="error"
          text="Couldn't load this poll's votes, so voting is paused here. Open it in chat to vote."
        />
      ) : null}
      {poll.refusal ? <CardNote tone="error" text={poll.refusal} /> : null}
      <CardActions>
        <CardButton
          label="Open in chat"
          accessibilityHint="Opens the poll in the channel it was posted in."
          onPress={() => {
            onNavigate();
            // Object form: the shape `lib/routes.spec.ts` matches when a
            // param is involved.
            router.push({
              pathname: "/chat-thread",
              params: {
                channelId: row.poll.channel_id,
                focusMessageId: row.poll.message_id,
              },
            });
          }}
        />
      </CardActions>
    </>
  );
}

/** The line a recorded review leaves where its buttons were. */
const REVIEWED_NOTE = {
  APPROVED: "Approved. Points are awarded per the chapter rate.",
  REJECTED: "Rejected. The member was notified.",
} as const;

function HoursSheet({
  row,
  viewerId,
  rowActionState,
  onActed,
}: {
  row: RowOf<"hours">;
  viewerId: string;
  /** The row's own Approve (#4437): sending holds these buttons, landed records it. */
  rowActionState: ActivityRowActionState;
  onActed: () => void;
}) {
  const message = useMemo(() => activityHoursMessage(row.entry), [row.entry]);
  const payload = readHoursPayload(message);
  const reviewEntry = useReviewServiceEntry();
  // A review has no outbox, so it is held while a write would be lost, as
  // the cards hold theirs.
  const { writeBlockedReason } = useConnection();
  const [reviewed, setReviewed] = useState<"APPROVED" | "REJECTED" | null>(
    null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  // `isPending` reaches React a tick after the press, so two taps in one
  // frame would both send; the ref is set before the first await.
  const inFlight = useRef(false);

  // The sheet stays open on the result, as it does after a vote: the card
  // re-reads the entry and shows its new status, and the row leaves "Needs
  // you" underneath.
  const review = async (status: "APPROVED" | "REJECTED") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    try {
      await reviewEntry.mutateAsync({ id: row.entry.id, body: { status } });
      setReviewed(status);
      onActed();
    } catch (error) {
      setFailure(hoursReviewFailure(error, status));
    } finally {
      inFlight.current = false;
    }
  };

  const disabled =
    reviewEntry.isPending ||
    rowActionState === "busy" ||
    writeBlockedReason !== null;
  const hint = writeBlockedReason ?? undefined;
  // Approved from its row while the list hadn't re-read yet: the same line
  // the sheet's own Approve leaves, rather than a second Approve the server
  // would refuse.
  const shownReview =
    reviewed ?? (rowActionState === "done" ? "APPROVED" : null);

  return (
    <>
      {payload ? (
        <HoursCard {...frameFor(message, viewerId)} payload={payload} />
      ) : null}
      {shownReview ? (
        <CardNote tone="success" text={REVIEWED_NOTE[shownReview]} />
      ) : (
        <CardActions>
          <CardButton
            label="Approve"
            variant="primary"
            disabled={disabled}
            accessibilityHint={hint}
            onPress={() => void review("APPROVED")}
          />
          <CardButton
            label="Reject"
            disabled={disabled}
            accessibilityHint={hint}
            onPress={() =>
              Alert.alert(
                `Reject "${row.entry.description || "this entry"}"?`,
                "The member is notified, and the hours are not credited. They can submit the entry again.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Reject entry",
                    style: "destructive",
                    onPress: () => void review("REJECTED"),
                  },
                ],
              )
            }
          />
        </CardActions>
      )}
      {failure ? <CardNote tone="error" text={failure} /> : null}
    </>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
    },
    stickyHeader: {
      // Sticky, so it paints the sheet's own fill over a card passing under.
      backgroundColor: tokens.color.surface.popover,
    },
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
  });
}
