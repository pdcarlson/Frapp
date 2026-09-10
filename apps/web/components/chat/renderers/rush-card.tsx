"use client";

import { RushGlyph } from "../chat-glyphs";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import type { RushPayload } from "@repo/chat-integrations";
import {
  useBidRushCandidate,
  useOrgConfig,
  useRushCandidate,
  useVoteRushCandidate,
} from "@repo/hooks";
import { vocab } from "@/lib/vocabulary";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

interface RushCardProps {
  message: ChatMessage;
  /** False while the optimistic chat row is not yet server-acked. */
  isConfirmed: boolean;
}

function readPayload(message: ChatMessage): RushPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.candidate_id !== "string" ||
    typeof r.display_name !== "string" ||
    typeof r.added_by_name !== "string"
  ) {
    return null;
  }
  const bid =
    r.bid_status === "extended" || r.bid_status === "none"
      ? r.bid_status
      : "none";
  return {
    candidate_id: r.candidate_id,
    display_name: r.display_name,
    added_by_user_id:
      typeof r.added_by_user_id === "string" ? r.added_by_user_id : "",
    added_by_name: r.added_by_name,
    stage: typeof r.stage === "string" ? r.stage : "new",
    bid_status: bid,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

/**
 * Candidate card: creation snapshot plus live vote/bid from GET. Vote is
 * one-click, not a toggle. Voter names are never rendered.
 */
export function RushCard({ message, isConfirmed }: RushCardProps) {
  const payload = readPayload(message);
  const orgConfig = useOrgConfig();
  const live = useRushCandidate(payload?.candidate_id);
  const vote = useVoteRushCandidate();
  const bid = useBidRushCandidate();
  const { toast } = useToast();

  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-base">
        {message.content}
      </div>
    );
  }

  const label = vocab("recruitment", orgConfig.data);
  const displayName = live.data?.display_name ?? payload.display_name;
  const voteCount = live.data?.vote_count ?? 0;
  const hasVoted = live.data?.viewer_has_voted ?? false;
  const bidStatus = live.data?.bid_status ?? payload.bid_status;
  const voteDisabled =
    !isConfirmed || hasVoted || vote.isPending || live.isPending;
  const bidDisabled = !isConfirmed || bidStatus === "extended" || bid.isPending;

  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(EYEBROW, "flex items-center gap-1.5 text-accent-text")}
        >
          <RushGlyph className="h-4 w-4" /> {label}
        </div>
        {bidStatus === "extended" ? (
          <Badge variant="success">Bid extended</Badge>
        ) : (
          <Badge variant="secondary">Open</Badge>
        )}
      </div>
      <div className="mt-2 text-base">
        <span className="font-semibold">{displayName}</span>
        <span className="text-muted-foreground"> · added by </span>
        <span className="font-semibold">{payload.added_by_name}</span>
      </div>
      <div className="mt-1 text-[12.5px] text-muted-foreground">
        {live.isError
          ? "Couldn't load votes"
          : voteCount === 1
            ? "1 vote"
            : `${voteCount} votes`}
        {hasVoted ? " · you voted" : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={voteDisabled}
          onClick={() =>
            vote.mutate(payload.candidate_id, {
              onError: (error) =>
                toast({
                  title: "Couldn't record that vote",
                  description: getErrorMessage(error, "Please try again."),
                  variant: "destructive",
                }),
            })
          }
        >
          {hasVoted ? "Voted" : "Vote"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={bidDisabled}
          onClick={() =>
            bid.mutate(payload.candidate_id, {
              onError: (error) =>
                toast({
                  title: "Couldn't extend that bid",
                  description: getErrorMessage(error, "Please try again."),
                  variant: "destructive",
                }),
            })
          }
        >
          {bidStatus === "extended" ? "Bid extended" : "Extend bid"}
        </Button>
      </div>
    </Card>
  );
}
