"use client";

import { DISCORD_ROUTES_WRITE_FOR_MEMBERS } from "@/lib/discord-error-copy";
import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useActiveChapterId,
  useBeginDiscordAuthorLink,
  useConfirmDiscordAuthorLink,
  useDiscordAuthorLink,
  useUnlinkDiscordAuthor,
} from "@repo/hooks";
import { MoreHorizontal, RotateCcw, Unlink } from "lucide-react";
import { discordLinkedState } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LinkedAppRow } from "@/components/linked-apps/linked-app-row";
import { DiscordMark } from "@/components/linked-apps/brand-marks";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { refreshTimelinesForDiscordAuthor } from "@/lib/chat/discord-author-reads";

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
 * Discord's row on Settings → Linked apps (`/preferences?section=apps`,
 * #2878, #5407): a member links their own Discord account so the chapter's
 * imported Discord history they wrote is attributed to them. It was the
 * Discord history section until Linked apps gathered every linked account.
 *
 * Linking is a round trip through Discord's sign-in. Discord sends the browser
 * back here with `?discord=pending&handshake=<token>`, and this card spends the
 * token from the member's own session on arrival, exactly once. Only the
 * member who started the handshake can spend it (the API checks), which is
 * what stops an authorize link completed by somebody else from putting their
 * history under this member's name.
 *
 * Linking and unlinking change who a message's sender is on the server.
 * Imported messages never arrive over Realtime, so afterwards cached chat
 * threads no screen shows are dropped, and an open one holding the affected
 * accounts' imported messages is refetched (`refreshTimelinesForDiscordAuthor`, #4543):
 * chat stays mounted beside this page.
 */
export function DiscordRow() {
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

  const refreshThreads = useCallback(
    (discordUserIds: string[] | null) => {
      void refreshTimelinesForDiscordAuthor(queryClient, discordUserIds);
    },
    [queryClient],
  );
  // The link status as of now, for the confirm below: a link to a different
  // account replaces the one held, and that account's rows go back to its
  // Discord name too. `undefined` while the status hasn't loaded.
  const linkedRef = useRef(link.data);
  useEffect(() => {
    linkedRef.current = link.data;
  }, [link.data]);

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
        const linked = result?.discord_user_id ?? null;
        const before = linkedRef.current;
        // Unknown if either account is: then every open thread holding an
        // imported row is refreshed.
        refreshThreads(
          linked === null || before === undefined
            ? null
            : [
                linked,
                ...(before.discord_user_id ? [before.discord_user_id] : []),
              ],
        );
        toast({ description: linkedMessage(result?.messages_linked ?? 0) });
      })
      .catch((error: unknown) => {
        toast({
          variant: "destructive",
          description: getErrorMessage(
            error,
            "Couldn't link your Discord account. Try again.",
            DISCORD_ROUTES_WRITE_FOR_MEMBERS,
          ),
        });
      });
  }, [chapterId, confirmLink, refreshThreads, toast]);

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
          DISCORD_ROUTES_WRITE_FOR_MEMBERS,
        ),
      });
    }
  }

  async function removeLink() {
    // Read before the unlink: its response doesn't name the account, and the
    // link status it invalidates may refetch first.
    const discordUserId = link.data?.discord_user_id ?? null;
    try {
      const result = await unlink.mutateAsync();
      refreshThreads(discordUserId === null ? null : [discordUserId]);
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
          DISCORD_ROUTES_WRITE_FOR_MEMBERS,
        ),
      });
    }
  }

  // No row before a chapter is active (the link is the chapter's), while the
  // status is unread, or where the server doesn't offer linking. A failed
  // read draws the row with a retry rather than "Not linked", which would
  // be a claim.
  if (!chapterId) return null;
  const busy = confirm.isPending || begin.isPending || unlink.isPending;
  if (link.isError) {
    return (
      <LinkedAppRow
        icon={<DiscordMark />}
        name="Discord"
        state={{ tone: "off", detail: "Couldn't load your Discord link" }}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Try loading your Discord link again"
          onClick={() => void link.refetch()}
        >
          <RotateCcw aria-hidden="true" />
        </Button>
      </LinkedAppRow>
    );
  }
  const state = confirm.isPending
    ? { tone: "off" as const, detail: "Linking…" }
    : discordLinkedState(link.data);
  if (!state) return null;

  return (
    <LinkedAppRow icon={<DiscordMark />} name="Discord" state={state}>
      {state.tone === "connected" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Discord options">
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={busy}
              onSelect={() => void removeLink()}
            >
              <Unlink aria-hidden="true" />
              Unlink
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="secondary"
          size="toolbar"
          aria-label="Link Discord account"
          disabled={busy}
          onClick={() => void startLink()}
        >
          Link
        </Button>
      )}
    </LinkedAppRow>
  );
}
