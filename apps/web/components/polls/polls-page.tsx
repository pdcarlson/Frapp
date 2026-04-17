"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCcw, Vote } from "lucide-react";
import {
  useChannels,
  usePolls,
  useRemoveVote,
  useVoteOnPoll,
} from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import { useToast } from "@/hooks/use-toast";
import { asArray } from "@/lib/utils";

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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function Poll({ poll, channelName }: { poll: PollRow; channelName: string }) {
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
          <Badge variant={poll.isExpired ? "outline" : "default"}>
            {poll.isExpired ? "Closed" : "Open"}
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
            <button
              key={result.optionIndex}
              type="button"
              disabled={poll.isExpired}
              onClick={() => toggleOption(result.optionIndex)}
              className={`w-full rounded-md border p-3 text-left transition ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted"
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
              <div
                aria-hidden="true"
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary"
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
          {!poll.isExpired ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!poll.userVotes?.length || unvote.isPending}
              onClick={() => void withdrawVote()}
            >
              Withdraw vote
            </Button>
          ) : null}
          {!poll.isExpired ? (
            <Button
              size="sm"
              disabled={
                selection.size === 0 ||
                vote.isPending ||
                (!isMultiChoice && selection.size !== 1)
              }
              onClick={() => void submitVote()}
            >
              {vote.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Vote className="h-4 w-4" />
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
    active:
      statusFilter === "ALL" ? undefined : statusFilter === "OPEN",
    limit: 50,
  });
  const polls = useMemo(() => asArray<PollRow>(pollsQuery.data), [pollsQuery.data]);

  return (
    <Can
      permission="polls:view_all"
      deniedFallback={
        <div className="space-y-4">
          <header>
            <h2 className="text-2xl font-semibold tracking-tight">Polls</h2>
            <p className="text-sm text-muted-foreground">
              The chapter-wide poll list and aggregate tallies require the{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                polls:view_all
              </code>{" "}
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
                className="w-[180px]"
                aria-label="Filter polls by channel"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_CHANNEL}>All channels</SelectItem>
                {channels.map((c) => (
                  <SelectItem key={c.id ?? "unknown"} value={String(c.id ?? "")}>
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
                className="w-[140px]"
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
              variant="outline"
              size="icon"
              onClick={() => void pollsQuery.refetch()}
              aria-label="Refresh polls"
              disabled={pollsQuery.isFetching}
            >
              {pollsQuery.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </header>

        {pollsQuery.isPending ? (
          <LoadingState message="Loading chapter polls..." />
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
