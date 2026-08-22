"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  useChannels,
  usePolls,
  useRemoveVote,
  useVoteOnPoll,
} from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { PollsGlyph } from "@/components/documents/resources-glyphs";
import { FOCUS_RING } from "@/components/ui/focus";
import {
  meterFillClassName,
  meterTrackClassName,
} from "@/components/shared/meter";
import { pollStatusKind, pollStatusLabel } from "./poll-status";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import {
  SubscriptionNotice,
  useSubscriptionGate,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/hooks/use-toast";
import { formatLocaleDateTime as formatDate } from "@repo/formatting";
import { asArray, getErrorMessage } from "@/lib/utils";

type PollResult = {
  optionIndex: number;
  optionText: string;
  voteCount: number;
};

type PollRow = {
  id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  metadata: {
    question?: string;
    options?: string[];
    choice_mode?: "single" | "multi";
    expires_at?: string | null;
  };
  created_at: string;
  isExpired: boolean;
  results: PollResult[];
  userVotes?: number[];
};

type ChannelRow = {
  id?: string;
  name?: string | null;
};

const ANY_CHANNEL = "__any_channel__";

function Poll({
  poll,
  channelName,
  gate,
}: {
  poll: PollRow;
  channelName: string;
  // The gate is owned by `PollsPage` rather than created per card: one verdict,
  // one notice, and every card's `aria-describedby` points at it.
  gate: SubscriptionGate;
}) {
  const { toast } = useToast();
  const vote = useVoteOnPoll();
  const unvote = useRemoveVote();

  const totalVotes = useMemo(
    () => poll.results.reduce((sum, r) => sum + r.voteCount, 0),
    [poll.results],
  );

  const [selection, setSelection] = useState<Set<number>>(
    new Set(poll.userVotes ?? []),
  );
  const isMultiChoice = poll.metadata.choice_mode === "multi";

  function toggleOption(index: number) {
    if (poll.isExpired) return;
    setSelection((prev) => {
      const next = new Set(prev);
      if (isMultiChoice) {
        if (next.has(index)) next.delete(index);
        else next.add(index);
      } else {
        next.clear();
        next.add(index);
      }
      return next;
    });
  }

  async function submitVote() {
    try {
      await vote.mutateAsync({
        messageId: poll.id,
        body: { option_indexes: Array.from(selection) },
      });
      toast({
        title: "Vote recorded",
        description: isMultiChoice
          ? "Your selections are saved."
          : "Your vote is saved.",
      });
    } catch (error) {
      toast({
        title: "Couldn't save vote",
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  async function withdrawVote() {
    try {
      await unvote.mutateAsync(poll.id);
      setSelection(new Set());
      toast({
        title: "Vote withdrawn",
        description: "You can vote again while the poll is open.",
      });
    } catch (error) {
      toast({
        title: "Couldn't withdraw vote",
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">
            {poll.metadata.question ?? poll.content}
          </CardTitle>
          <CardDescription>
            {channelName} · Created {formatDate(poll.created_at)}
            {poll.metadata.expires_at
              ? ` · ${poll.isExpired ? "Closed" : "Closes"} ${formatDate(
                  poll.metadata.expires_at,
                )}`
              : ""}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {/*
            `variant="default"` is §5's Accent kind — the chapter's own colour
            on a domain status, which is #1202's defect reached by an inline
            ternary. `poll-status.ts` owns both the kind and the label now.
          */}
          <Badge variant={pollStatusKind(!poll.isExpired)}>
            {pollStatusLabel(!poll.isExpired)}
          </Badge>
          <Badge variant="outline">
            {isMultiChoice ? "Multi-choice" : "Single choice"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {poll.results.map((result) => {
          const pct =
            totalVotes > 0
              ? Math.round((result.voteCount / totalVotes) * 100)
              : 0;
          const isSelected = selection.has(result.optionIndex);
          return (
            // Not gated: this row is the results display (a read, and §5 gates
            // writes only) and its click only moves local selection state. The
            // write it feeds — Save vote, one control below — carries the gate
            // and states the reason there.
            <button
              key={result.optionIndex}
              type="button"
              disabled={poll.isExpired}
              onClick={() => toggleOption(result.optionIndex)}
              className={`w-full rounded-md border p-3 text-left transition ${FOCUS_RING} ${
                isSelected
                  ? "border-accent-border bg-accent-subtle-hover text-accent-text"
                  : "border-border enabled:hover:bg-accent-subtle"
              } disabled:cursor-not-allowed disabled:opacity-70`}
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{result.optionText}</span>
                <span className="text-xs text-muted-foreground">
                  {result.voteCount} vote{result.voteCount === 1 ? "" : "s"}
                  {" · "}
                  {pct}%
                </span>
              </div>
              <div aria-hidden="true" className={`mt-2 ${meterTrackClassName}`}>
                <div
                  className={meterFillClassName}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {totalVotes} total vote{totalVotes === 1 ? "" : "s"}
        </span>
        <div className="flex gap-2">
          {/*
            `DELETE /v1/polls/:messageId/vote` is paid-ops like the vote POST,
            so gating only Save would have the card claim writes are blocked
            while still offering one.
          */}
          {!poll.isExpired ? (
            <Button
              size="sm"
              variant="secondary"
              {...gate.controlProps(
                !poll.userVotes?.length || unvote.isPending,
              )}
              onClick={() => void withdrawVote()}
            >
              Withdraw vote
            </Button>
          ) : null}
          {!poll.isExpired ? (
            <Button
              size="sm"
              {...gate.controlProps(
                selection.size === 0 ||
                  vote.isPending ||
                  (!isMultiChoice && selection.size !== 1),
              )}
              onClick={() => void submitVote()}
            >
              {vote.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PollsGlyph className="h-4 w-4" />
              )}
              Save vote
            </Button>
          ) : null}
        </div>
      </CardFooter>
    </Card>
  );
}

export function PollsPage() {
  // `POST /v1/polls/:messageId/vote` and its DELETE carry no `@FreeTier`, so
  // both are paid-ops and mirror the gate (#841). The list, the filters, and
  // the tallies stay live — `enforceSubscription` returns early for GET.
  const gate = useSubscriptionGate();
  const { isOffline } = useNetwork();
  const [channelFilter, setChannelFilter] = useState<string>(ANY_CHANNEL);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "CLOSED">(
    "ALL",
  );

  const channelsQuery = useChannels();
  const channels = useMemo(
    () => asArray<ChannelRow>(channelsQuery.data),
    [channelsQuery.data],
  );
  const channelNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of channels) {
      if (c.id) map.set(String(c.id), c.name ?? "Channel");
    }
    return map;
  }, [channels]);

  const pollsQuery = usePolls({
    channelId: channelFilter === ANY_CHANNEL ? undefined : channelFilter,
    active: statusFilter === "ALL" ? undefined : statusFilter === "OPEN",
    limit: 50,
  });
  const polls = useMemo(
    () => asArray<PollRow>(pollsQuery.data),
    [pollsQuery.data],
  );

  return (
    <Can
      permission="polls:view_all"
      fallback={
        <div className="space-y-4">
          <header>
            <h2 className="text-2xl font-semibold tracking-tight">Polls</h2>
            <p className="text-sm text-muted-foreground">
              Checking your chapter permissions&hellip;
            </p>
          </header>
        </div>
      }
      deniedFallback={
        <div className="space-y-4">
          <header>
            <h2 className="text-2xl font-semibold tracking-tight">Polls</h2>
            <p className="text-sm text-muted-foreground">
              The chapter-wide poll list and aggregate tallies require the{" "}
              <code className="font-mono text-xs">polls:view_all</code>{" "}
              permission. Ask your chapter president to grant it if you need
              this view; you can still vote on polls from chat channels you can
              access.
            </p>
          </header>
        </div>
      }
    >
      <div className="space-y-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Polls</h2>
            <p className="text-sm text-muted-foreground">
              Chapter-wide poll list. Vote, change your mind, or review results.
              Polls are created inside chat channels; this surface is the
              at-a-glance summary with live vote tallies.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger
                className="h-11 w-[180px]"
                aria-label="Filter polls by channel"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_CHANNEL}>All channels</SelectItem>
                {channels.map((c) => (
                  <SelectItem
                    key={c.id ?? "unknown"}
                    value={String(c.id ?? "")}
                  >
                    {c.name ?? "Channel"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                setStatusFilter(value as "ALL" | "OPEN" | "CLOSED")
              }
            >
              <SelectTrigger
                className="h-11 w-[140px]"
                aria-label="Filter polls by status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="OPEN">Open polls</SelectItem>
                <SelectItem value="CLOSED">Closed polls</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => void pollsQuery.refetch()}
              aria-label="Refresh polls"
              disabled={pollsQuery.isFetching}
            >
              {pollsQuery.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </header>

        {/*
          Disable, don't hide (§5 rule 4): the poll list and its tallies keep
          working for a lapsed chapter — only casting and withdrawing votes
          stops, and this says why.
        */}
        <SubscriptionNotice gate={gate} feature="voting on polls" />

        {/*
          `usePolls` is `enabled: !!chapterId && polls:view_all`. A disabled
          TanStack Query v5 stays `isPending` forever with `fetchStatus:
          "idle"`. `isLoading` is a fetch in flight; `fetchStatus ===
          "paused"` is offline with no data — same `isPending &&
          !isFetching` pair as disabled, but the member has the grant.
          Gating the spinner on `isPending` is how a member without
          `polls:view_all` used to spin forever (#872).

          The offline branch sits above all three and inside `Can`, which is
          the Chapter Ops ordering: permission, then network, then data. It
          also has to come first among the query branches, because a paused
          query is `isPending` and would otherwise spin behind an offline
          member indefinitely — README §4 requires an offline state with a
          retry here, not a spinner that cannot resolve.
        */}
        {isOffline ? (
          <OfflineState
            title="Polls unavailable offline"
            description="Reconnect to load the chapter's polls and cast a vote."
            onRetry={() => {
              void pollsQuery.refetch();
            }}
          />
        ) : pollsQuery.isLoading || pollsQuery.fetchStatus === "paused" ? (
          <LoadingState message="Loading chapter polls..." />
        ) : pollsQuery.isPending && pollsQuery.fetchStatus === "idle" ? (
          <EmptyState
            title="Poll list requires polls:view_all"
            description="Ask your chapter president to grant it if you need this view. You can still vote on polls from chat channels you can access."
          />
        ) : pollsQuery.isError ? (
          <ErrorState
            title="Couldn't load polls"
            description="Confirm your chapter access and retry, or confirm you have polls:view_all access."
            onRetry={() => void pollsQuery.refetch()}
          />
        ) : polls.length === 0 ? (
          <EmptyState
            title="No polls match this view"
            description="Create a poll inside a chat channel and it will appear here. Loosen the filters if you're expecting results."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {polls.map((poll) => (
              <Poll
                key={poll.id}
                poll={poll}
                gate={gate}
                channelName={
                  channelNameById.get(poll.channel_id) ?? "Unknown channel"
                }
              />
            ))}
          </div>
        )}
      </div>
    </Can>
  );
}
