"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CHAT_MESSAGE_QUERY_ROOT } from "@repo/chat-core/types";
import {
  useActiveChapterId,
  useBeginDiscordAuthorLink,
  useConfirmDiscordAuthorLink,
  useDiscordAuthorLink,
  useUnlinkDiscordAuthor,
} from "@repo/hooks";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
} from "@/components/shared/nested-states";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

export const DISCORD_HISTORY_TITLE = "Discord history";
export const DISCORD_HISTORY_DESCRIPTION =
  "If your chapter imported its Discord server, link the Discord account you used there. Your old messages then show under your name in this chapter, and you can delete them like any message of yours.";

/**
 * What `?discord=<code>` means when Discord sends the browser back here.
 *
 * A code, never text: the API keeps Discord's `error_description` off the URL,
 * because rendering outside-chosen text in our own chrome is a phishing
 * surface. `pending` is not listed: the card confirms it and reports what
 * actually happened.
 */
export const DISCORD_LINK_OUTCOME_MESSAGES: Record<string, string> = {
  declined: "Linking was cancelled on Discord. Nothing changed.",
  expired: "That Discord link expired. Link your account again.",
  invalid: "Discord didn't finish signing you in. Link your account again.",
  failed: "Couldn't link your Discord account. Try again in a minute.",
};

export function linkedMessage(count: number): string {
  if (count === 0) {
    return "Discord account linked. Messages you wrote under it will show as yours when your chapter imports them.";
  }
  return count === 1
    ? "Discord account linked. 1 imported message now shows as yours."
    : `Discord account linked. ${count} imported messages now show as yours.`;
}

/**
 * `/profile` → Discord history (#2878): a member links their own Discord
 * account so the chapter's imported Discord history they wrote is attributed
 * to them.
 *
 * Linking is a round trip through Discord's sign-in. Discord sends the browser
 * back here with `?discord=pending&handshake=<token>`, and this card spends the
 * token from the member's own session on arrival, exactly once. Only the
 * member who started the handshake can spend it (the API checks), which is
 * what stops an authorize link completed by somebody else from putting their
 * history under this member's name.
 *
 * Linking and unlinking change who a message's sender is on the server.
 * Imported messages never arrive over Realtime, so cached chat threads are
 * dropped afterwards (only ones no screen is showing) and read fresh on the
 * next visit to chat.
 */
export function DiscordHistoryCard() {
  const chapterId = useActiveChapterId();
  const link = useDiscordAuthorLink();
  const begin = useBeginDiscordAuthorLink();
  const confirm = useConfirmDiscordAuthorLink();
  const unlink = useUnlinkDiscordAuthor();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Read once, on mount, then stripped from the address bar: the token is a
  // one-time credential, and a URL is the most-copied place a value can sit.
  // A ref, not state: nothing renders from it, and the spend below re-runs
  // when the chapter becomes known.
  const handshake = useRef<string | null>(null);
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("discord");
    if (!outcome) return;

    const token = url.searchParams.get("handshake");
    if (outcome === "pending" && token) {
      handshake.current = token;
    } else {
      // Own keys only: `outcome` is whatever the URL says, and a plain object
      // would answer `?discord=constructor` with a function.
      const message = Object.hasOwn(DISCORD_LINK_OUTCOME_MESSAGES, outcome)
        ? DISCORD_LINK_OUTCOME_MESSAGES[outcome]
        : undefined;
      if (message) {
        toast({
          variant: outcome === "declined" ? undefined : "destructive",
          description: message,
        });
      }
    }
    url.searchParams.delete("discord");
    url.searchParams.delete("handshake");
    window.history.replaceState(null, "", url.toString());
  }, [toast]);

  const dropCachedThreads = useCallback(() => {
    queryClient.removeQueries({
      queryKey: [CHAT_MESSAGE_QUERY_ROOT],
      type: "inactive",
    });
  }, [queryClient]);

  // Spent exactly once, as soon as a chapter is active. Clearing the ref is
  // what stops React's development double-invoke from spending it twice, which
  // would report a failure over a link that worked.
  const confirmLink = confirm.mutateAsync;
  useEffect(() => {
    const token = handshake.current;
    if (!token || !chapterId) return;
    handshake.current = null;
    confirmLink({ handshake: token })
      .then((result) => {
        dropCachedThreads();
        toast({ description: linkedMessage(result?.messages_linked ?? 0) });
      })
      .catch((error: unknown) => {
        toast({
          variant: "destructive",
          description: getErrorMessage(
            error,
            "Couldn't link your Discord account. Try again.",
          ),
        });
      });
  }, [chapterId, confirmLink, dropCachedThreads, toast]);

  async function startLink() {
    try {
      const result = await begin.mutateAsync();
      if (!result?.authorize_url) {
        throw new Error("The API did not return a Discord link.");
      }
      // A full navigation: Discord's sign-in refuses to render in a frame, and
      // a popup is what browsers block.
      window.location.assign(result.authorize_url);
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(
          error,
          "Couldn't start linking your Discord account.",
        ),
      });
    }
  }

  async function removeLink() {
    try {
      const result = await unlink.mutateAsync();
      dropCachedThreads();
      toast({
        description:
          result && result.messages_restored > 0
            ? `Discord account unlinked. ${result.messages_restored} imported ${result.messages_restored === 1 ? "message shows" : "messages show"} under the Discord name again.`
            : "Discord account unlinked.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(
          error,
          "Couldn't unlink your Discord account.",
        ),
      });
    }
  }

  let body: React.ReactNode;
  if (!chapterId) {
    body = (
      <NestedEmpty
        title="Select a chapter"
        description="A Discord account is linked per chapter, so this appears once a chapter is active."
      />
    );
  } else if (confirm.isPending) {
    body = <NestedLoading message="Linking your Discord account" lines={1} />;
  } else if (link.isPending) {
    body = <NestedLoading message="Loading your Discord link" lines={1} />;
  } else if (link.isError || !link.data) {
    body = (
      <NestedError
        title="Couldn't load your Discord link"
        description="Check your connection and try again."
        onRetry={() => void link.refetch()}
      />
    );
  } else if (link.data.linked) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm">
          Linked
          {link.data.discord_username ? (
            <>
              {" "}
              as{" "}
              <span className="font-semibold">
                {link.data.discord_username}
              </span>
            </>
          ) : null}
          . Your imported messages in this chapter show under your name.
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={unlink.isPending}
          onClick={() => void removeLink()}
        >
          Unlink
        </Button>
      </div>
    );
  } else if (!link.data.available) {
    body = (
      <p className="text-sm text-muted-foreground">
        Linking a Discord account isn&apos;t available right now.
      </p>
    );
  } else {
    body = (
      <Button disabled={begin.isPending} onClick={() => void startLink()}>
        Link Discord account
      </Button>
    );
  }

  return (
    <Card id="discord-history" className="scroll-mt-16">
      <CardHeader>
        <CardTitle>{DISCORD_HISTORY_TITLE}</CardTitle>
        <CardDescription>{DISCORD_HISTORY_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
