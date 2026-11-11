import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
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
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  CardActions,
  CardButton,
  CardNote,
  type ChatCardFrameProps,
} from "@/components/chat/chat-card";
import { EventCard } from "@/components/chat/event-card";
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
import { useActivityPoll } from "@/lib/activity/use-activity-poll";
import { confirmClosePoll } from "@/lib/chat/confirm-close-poll";
import { useConnection } from "@/lib/connection/use-connection";
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";
import { useFrappTheme } from "@/lib/theme";

type RowOf<K extends ActivityRow["kind"]> = Extract<ActivityRow, { kind: K }>;

/** A row that opens the sheet: a file row goes to its own screen instead. */
export type ActivitySheetRow = Exclude<ActivityRow, { kind: "file" }>;

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
 * A tall sheet, as `spec/ui/mobile/patterns.md` § Bottom sheets gives a sheet
 * that holds a whole record. A sheet is drawn outside the screen's
 * navigator, so the screen's navigation context is handed down to the cards:
 * their refusals clear when the member comes back to this screen
 * (`useCardWrite`), as they do in a thread.
 *
 * `onActed` runs after an action this sheet makes itself (a vote, a review),
 * so the row can leave "Needs you"; `onClosed` runs when the sheet has gone,
 * which is when the screen re-reads for what the cards' own buttons changed
 * and lets go of `row`. Until then the screen keeps handing the row down, so
 * the card stays drawn while the sheet slides away.
 */
export function ActivitySheet({
  row,
  viewerId,
  onClosed,
  onActed,
}: {
  row: ActivitySheetRow | null;
  viewerId: string | null;
  onClosed: () => void;
  onActed: () => void;
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
                onActed={onActed}
                onNavigate={closeSheet}
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
  onActed,
  onNavigate,
}: {
  row: ActivitySheetRow;
  viewerId: string;
  onActed: () => void;
  /** Closes the sheet before leaving this screen for another. */
  onNavigate: () => void;
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
      return <HoursSheet row={row} viewerId={viewerId} onActed={onActed} />;
  }
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
      <EventCard {...frameFor(message, viewerId)} payload={payload} />
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
          accessibilityHint="Opens the channel this poll was posted in."
          onPress={() => {
            onNavigate();
            // Object form: the shape `lib/routes.spec.ts` matches when a
            // param is involved.
            router.push({
              pathname: "/chat-thread",
              params: { channelId: row.poll.channel_id },
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
  onActed,
}: {
  row: RowOf<"hours">;
  viewerId: string;
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
      // The two refusals a retry can't win, in a member's words, as the
      // phone's other paid-ops writes say them.
      const gate = subscriptionRefusalOf(error)
        ? SUBSCRIPTION_REFUSAL_COPY.serviceReview
        : moduleRefusalOf(error)
          ? MODULE_REFUSAL_COPY.serviceReview
          : null;
      setFailure(
        gate ??
          errorCopy(
            error,
            status === "APPROVED"
              ? "Only a pending entry someone else submitted can be approved."
              : "Couldn't reject this entry. Try again in a moment.",
          ),
      );
    } finally {
      inFlight.current = false;
    }
  };

  const disabled = reviewEntry.isPending || writeBlockedReason !== null;
  const hint = writeBlockedReason ?? undefined;

  return (
    <>
      {payload ? (
        <HoursCard {...frameFor(message, viewerId)} payload={payload} />
      ) : null}
      {reviewed ? (
        <CardNote tone="success" text={REVIEWED_NOTE[reviewed]} />
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
