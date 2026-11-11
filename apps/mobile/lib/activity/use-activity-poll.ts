import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACTIVITY_POLL_VOTES_REFRESH_MS,
  activityPollMessage,
  readActivityPollVotes,
} from "@repo/chat-core/activity-cards";
import {
  actOnDetachedCard,
  classifyChatError,
  closeDetachedPoll,
} from "@repo/chat-core/chat-client";
import { memberFacingRefusal } from "@repo/chat-core/polls";
import type { ChatMessage, RawChatMessage } from "@repo/chat-core/types";
import {
  activityKeys,
  useActiveChapterId,
  useFrappClient,
  type ActivityPoll,
} from "@repo/hooks";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * One Activity poll as the message chat's own `PollCard` draws, with the two
 * things the card can do: vote, and close (#3897). Web's twin is
 * `apps/web/components/activity/use-activity-poll.ts`; the read, the vote and
 * the close are chat-core's, shared by both.
 *
 * The votes get their own read (`readActivityPollVotes`), re-read on an
 * interval while the card is open and after each vote, because this screen
 * holds no channel subscription. The vote and the close go through the same
 * routes chat's card uses, with the answer merged into the channel's chat
 * cache when that channel is loaded, so the thread is not left showing a
 * stale tally.
 *
 * Mobile has no toast, so a refused vote is `refusal`, a line the sheet
 * draws under the card. A refused close rejects instead: the caller confirms
 * through `confirmClosePoll`, which already reports a failed close.
 */
export function useActivityPoll(poll: ActivityPoll) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [refusal, setRefusal] = useState<string | null>(null);
  const messageId = poll.message_id;
  const channelId = poll.channel_id;

  const votesKey = useMemo(
    () => [...activityKeys.chapter(chapterId ?? ""), "poll-votes", messageId],
    [chapterId, messageId],
  );
  const votes = useQuery({
    queryKey: votesKey,
    queryFn: () => {
      // No client is a build with no Supabase configured: a failed read, so
      // the card holds its vote buttons rather than tally from nothing.
      if (!supabase) throw new Error("Couldn't read this poll's votes");
      return readActivityPollVotes(supabase, messageId);
    },
    enabled: !!chapterId,
    refetchInterval: poll.is_closed ? false : ACTIVITY_POLL_VOTES_REFRESH_MS,
  });

  const message: ChatMessage = useMemo(
    () =>
      activityPollMessage(
        poll.message as unknown as RawChatMessage,
        votes.data ?? [],
      ),
    [poll.message, votes.data],
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

  const vote = useCallback(
    async (
      votedMessageId: string,
      actionType: string,
      payload: Record<string, unknown>,
    ) => {
      setRefusal(null);
      try {
        await actOnDetachedCard(
          { queryClient, apiClient: client },
          { channelId, messageId: votedMessageId, actionType, payload },
        );
        await refresh();
      } catch (error) {
        setRefusal(memberFacingRefusal(classifyChatError(error).message));
      }
    },
    [client, queryClient, channelId, refresh],
  );

  const close = useCallback(
    async (closedMessageId: string) => {
      await closeDetachedPoll(
        { queryClient, apiClient: client },
        { channelId, messageId: closedMessageId },
      );
      await refresh();
    },
    [client, queryClient, channelId, refresh],
  );

  return {
    message,
    /** The votes could not be read, so the card's tallies are not to be trusted. */
    votesFailed: votes.isError,
    votesLoading: votes.isPending,
    /** Why the last vote was refused, in a member's words. */
    refusal,
    vote,
    close,
  };
}
