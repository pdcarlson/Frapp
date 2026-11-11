"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { activityPollMessage } from "@repo/chat-core/activity-cards";
import {
  actOnDetachedCard,
  classifyChatError,
  closeDetachedPoll,
} from "@repo/chat-core/chat-client";
import { readMessageActions } from "@repo/chat-core/history";
import { memberFacingRefusal } from "@repo/chat-core/polls";
import type { ChatMessage, RawChatMessage } from "@repo/chat-core/types";
import { activityKeys, useActiveChapterId, useFrappClient } from "@repo/hooks";
import { getRealtimeClient } from "@/lib/realtime/supabase-realtime";
import { useToast } from "@/lib/hooks/use-toast";
import type { ActivityPoll } from "./activity-rows";

/** How often an open poll's votes are re-read while its card is on screen. */
const VOTES_REFRESH_MS = 15_000;

/**
 * One Activity poll as the message chat's own `PollCard` draws, with the two
 * things the card can do: vote, and close.
 *
 * Chat keeps a poll's votes current through the channel's live subscription,
 * which this page does not hold, so the votes get their own read here:
 * `chat_message_actions` for this one message, under the member's own session
 * (the table's read policy is the channel-access rule, so a poll the member
 * cannot read returns no votes), re-read on an interval while the card is
 * open and after each vote, through chat's own paged read
 * (`readMessageActions`). The vote and the close are chat-core's
 * (`actOnDetachedCard`, `closeDetachedPoll`): the same routes chat's card
 * uses, with the answer merged into the channel's chat cache when that
 * channel is loaded, so the thread is not left showing a stale tally.
 */
export function useActivityPoll(poll: ActivityPoll | null) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const messageId = poll?.message_id ?? "";
  const channelId = poll?.channel_id ?? "";

  const votesKey = useMemo(
    () => [...activityKeys.chapter(chapterId ?? ""), "poll-votes", messageId],
    [chapterId, messageId],
  );
  const votes = useQuery({
    queryKey: votesKey,
    queryFn: async () => {
      // Chat's own paged read of a message's actions. A partial set would
      // draw a wrong tally, so it is a failed read here.
      const { actions, incomplete } = await readMessageActions(
        getRealtimeClient(),
        [messageId],
      );
      if (incomplete) throw new Error("Couldn't read this poll's votes");
      return actions;
    },
    enabled: !!chapterId && !!messageId,
    refetchInterval: poll && !poll.is_closed ? VOTES_REFRESH_MS : false,
  });

  const message: ChatMessage | null = useMemo(
    () =>
      poll
        ? activityPollMessage(
            poll.message as unknown as RawChatMessage,
            votes.data ?? [],
          )
        : null,
    [poll, votes.data],
  );

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: votesKey }),
      chapterId
        ? queryClient.invalidateQueries({
            queryKey: activityKeys.chapter(chapterId),
            exact: true,
          })
        : Promise.resolve(),
    ]);
  }, [queryClient, votesKey, chapterId]);

  const fail = useCallback(
    (title: string, error: unknown) => {
      toast({
        title,
        description: memberFacingRefusal(classifyChatError(error).message),
        variant: "destructive",
      });
    },
    [toast],
  );

  const vote = useCallback(
    async (
      votedMessageId: string,
      actionType: string,
      payload: Record<string, unknown>,
    ) => {
      try {
        await actOnDetachedCard(
          { queryClient, apiClient: client },
          { channelId, messageId: votedMessageId, actionType, payload },
        );
        await refresh();
      } catch (error) {
        fail("Couldn't record your vote", error);
      }
    },
    [client, queryClient, channelId, refresh, fail],
  );

  const close = useCallback(
    async (closedMessageId: string) => {
      try {
        await closeDetachedPoll(
          { queryClient, apiClient: client },
          { channelId, messageId: closedMessageId },
        );
        await refresh();
      } catch (error) {
        fail("Couldn't close poll", error);
      }
    },
    [client, queryClient, channelId, refresh, fail],
  );

  return {
    message,
    /** The votes could not be read, so the card's tallies are not to be trusted. */
    votesFailed: votes.isError,
    votesLoading: votes.isPending && !!messageId,
    vote,
    close,
  };
}
