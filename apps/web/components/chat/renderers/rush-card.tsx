"use client";

import { CheckCircle2 } from "lucide-react";
import { RushGlyph } from "../chat-glyphs";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import { readRushPayload } from "@repo/chat-core/cards";
import {
  canReadCardRushCandidate,
  readLiveRushCandidate,
  RUSH_CARD_TALLY_ERROR,
  rushCardBadgeLabel,
  rushCardControls,
  rushCardGateRefusal,
  rushCardTally,
  useBidRushCandidate,
  useMyPermissions,
  useRushCandidate,
  useVoteRushCandidate,
} from "@repo/hooks";
import { vocab } from "@repo/org-archetypes";
import { can } from "@repo/validation";
import { useChapterModuleGateState } from "@/lib/hooks/use-chapter-module-gate";
import { useChapterVocabulary } from "@/lib/hooks/use-chapter-vocabulary";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

interface RushCardProps {
  message: ChatMessage;
  /** False while the optimistic chat row is not yet server-acked. */
  isConfirmed: boolean;
}

/**
 * Candidate card: the creation snapshot (the name, who added them) plus the
 * live bid and votes from `GET /v1/rush/candidates/:id`. Vote is one-click,
 * not a toggle, and voter names are never rendered.
 *
 * Which controls show, the badge and the tally are `rushCardControls`,
 * `rushCardBadgeLabel` and `rushCardTally` in `@repo/hooks`, the rules the
 * mobile card applies too. Nothing live is drawn until the candidate is read:
 * the snapshot has no votes and its bid is `"none"` forever. Every member may
 * vote and extend a bid; only `members:view` is needed to read the candidate,
 * so nobody known to lack it asks. While Recruitment is known to be off the card
 * offers nothing (the server refuses both writes), and a gate's refusal is
 * told in a member's words (`rushCardGateRefusal`), not the officer-addressed
 * message the guard sends.
 */
export function RushCard({ message, isConfirmed }: RushCardProps) {
  const payload = readRushPayload(message);
  const chapterVocabulary = useChapterVocabulary();
  const { data: permissionsPayload } = useMyPermissions();
  const permissions = permissionsPayload?.permissions;
  const canViewMembers = can("members:view", permissions);
  // Hooks must run before the malformed-payload return; the read no-ops
  // without an id.
  const liveQuery = useRushCandidate(
    payload &&
      canReadCardRushCandidate({
        canViewMembers,
        permissionsKnown: Array.isArray(permissions),
      })
      ? payload.candidate_id
      : undefined,
  );
  const vote = useVoteRushCandidate();
  const bid = useBidRushCandidate();
  // Both writes are paid-ops on `rush.controller.ts`; a card in the free chat
  // surface doesn't inherit chat's tier (#841).
  const gate = useSubscriptionGate();
  const moduleGate = useChapterModuleGateState();
  const { toast } = useToast();

  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-base">
        {message.content}
      </div>
    );
  }

  const live = readLiveRushCandidate(liveQuery.data);
  const label = vocab("recruitment", chapterVocabulary);
  const recruitmentOff =
    moduleGate.status === "ready" && !moduleGate.isModuleEnabled("rush");
  const controls = rushCardControls({ live, recruitmentOff });
  const actionsDisabled = !isConfirmed || vote.isPending || bid.isPending;
  const tally = live
    ? rushCardTally(live)
    : liveQuery.isError
      ? RUSH_CARD_TALLY_ERROR
      : null;

  function onFailure(title: string, fallback: string) {
    return {
      onError: (error: unknown) =>
        toast({
          title,
          description:
            rushCardGateRefusal(error) ?? getErrorMessage(error, fallback),
          variant: "destructive",
        }),
    };
  }

  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            EYEBROW,
            "flex items-center gap-1.5 text-muted-foreground",
          )}
        >
          <RushGlyph className="h-4 w-4" /> {label}
        </div>
        {live ? (
          <Badge variant={live.bid_extended ? "success" : "secondary"}>
            {rushCardBadgeLabel(live)}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 text-base">
        <span className="font-semibold">
          {live?.display_name ?? payload.display_name}
        </span>
        <span className="text-muted-foreground"> · added by </span>
        <span className="font-semibold">{payload.added_by_name}</span>
      </div>
      {tally ? (
        <div className="mt-1 text-caption text-muted-foreground">{tally}</div>
      ) : null}
      {controls.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {controls.includes("vote") ? (
            <Button
              type="button"
              size="sm"
              {...gate.controlProps(actionsDisabled)}
              onClick={() =>
                vote.mutate(
                  payload.candidate_id,
                  onFailure("Couldn't record that vote", "Please try again."),
                )
              }
            >
              Vote
            </Button>
          ) : null}
          {controls.includes("voted") ? (
            // An indicator, not an action: there is no unvote.
            <Button type="button" size="sm" disabled>
              <CheckCircle2 className="h-4 w-4" />
              Voted
            </Button>
          ) : null}
          {controls.includes("bid") ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              {...gate.controlProps(actionsDisabled)}
              onClick={() =>
                bid.mutate(
                  payload.candidate_id,
                  onFailure("Couldn't extend that bid", "Please try again."),
                )
              }
            >
              Extend bid
            </Button>
          ) : null}
          {/* Only under something the gate holds back: the Voted indicator
              alone has nothing to restore. */}
          {controls.some((control) => control !== "voted") ? (
            <SubscriptionNotice
              gate={gate}
              feature="voting and extending bids"
              className="mb-0 w-full"
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
