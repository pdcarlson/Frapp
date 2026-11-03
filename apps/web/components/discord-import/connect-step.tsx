"use client";

import { useEffect, useRef } from "react";
import {
  useBeginDiscordConnect,
  useConfirmDiscordConnect,
  useDiscordAvailability,
  useDiscordConnection,
} from "@repo/hooks";
import { statusOf } from "@repo/api-sdk";
import { Button } from "@/components/ui/button";
import {
  NestedError,
  NestedLoading,
  NestedOffline,
} from "@/components/shared/nested-states";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { readIsOffline } from "@/components/shared/async-states";
import { StaleReadNotice } from "@/components/shared/stale-read-notice";
import { useToast } from "@/lib/hooks/use-toast";
import { useNetwork } from "@/lib/providers/network-provider";
import { getErrorMessage } from "@/lib/utils";

/**
 * Where the browser comes back to after Discord.
 *
 * Carries `wizard=bot` so the page can reopen the wizard on this step instead
 * of dropping the admin back on the import list with no idea whether it worked.
 * The API reduces this to a site-relative path before storing it and resolves
 * it against its own configured app origin on the way back, so it cannot be
 * turned into an off-site redirect.
 */
export const DISCORD_CONNECT_RETURN_PATH = "/discord-import?wizard=bot";

/**
 * Link the chapter's Discord server.
 *
 * The whole step is one button and a status line, which is the point: the admin
 * never sees, pastes, or stores a token. They authorize the Frapp bot through
 * Discord's ordinary "Add to Server" screen, and what Frapp keeps afterwards is
 * a server id — a public number that does nothing without the install behind it.
 *
 * Discord will only let this finish if the person doing it has **Manage Server**
 * on the server they pick. That is checked by Discord and re-read by the API
 * under the authorizing account's own token; it is not something the browser
 * asserts.
 */
export function ConnectStep({
  onConnected,
  accessGiven,
  onAccessGivenChange,
  handshake = null,
  onHandshakeSpent,
  confirmError,
  onConfirmErrorChange,
}: {
  onConnected: () => void;
  /**
   * The admin's answer to "have you given the bot access to the channels?".
   * Asked before the scan, not discovered after it: Discord shows the bot
   * only what its roles can see, and most chapter servers hide their channels
   * from a newcomer (on the first real import it could read 2 of 78, #2812).
   * Held by the wizard, like the consent answer, so Back does not clear it.
   */
  accessGiven: boolean;
  onAccessGivenChange: (next: boolean) => void;
  /**
   * The one-time token the OAuth callback put on the redirect.
   *
   * Present exactly when this browser is the one that just completed the
   * authorization. Confirming is what actually links the server — the callback
   * parks it and links nothing, so that an authorize URL completed by somebody
   * else's Discord admin cannot attach their server to whoever generated it.
   */
  handshake?: string | null;
  /**
   * Whether the wizard should stop passing the token. `true` the moment the
   * confirm is sent: Back unmounts this step, and a fresh one would post it
   * again. `false` if the confirm then failed with anything but the API's
   * 400, so a later visit to this step can send it again rather than make the
   * admin authorize from the start. A 503 (Discord withdrawn) is refused
   * before the token is touched. A 5xx from linking the server, or a response
   * lost on the way back, may follow a spent token; resending one costs only
   * a refused 400, and a connection that did commit shows as connected.
   */
  onHandshakeSpent?: (spent: boolean) => void;
  /**
   * Why the last confirm was refused, held by the wizard: Back unmounts this
   * step, and a refused token is not sent again, so a revisit would otherwise
   * show the plain "not connected" pitch with the reason gone.
   */
  confirmError: string | null;
  onConfirmErrorChange: (message: string | null) => void;
}) {
  const { toast } = useToast();
  const connection = useDiscordConnection();
  const { isOffline } = useNetwork();
  const availability = useDiscordAvailability();
  const beginConnect = useBeginDiscordConnect();
  const confirmConnect = useConfirmDiscordConnect();

  const connected = connection.data?.connected === true;
  // The API can withdraw the flow while this step is open: it re-reads
  // Discord before every connect, and a refusal re-asks for availability. Only
  // an explicit `false` withdraws; a pending or failed availability read leaves
  // the button alone and lets the connect answer for itself.
  const withdrawn = availability.data?.available === false;

  // Confirmed automatically, and exactly once. The admin who started this in
  // this chapter has nothing to decide — their session and the parked guild
  // already agree, and the chapter check happens server-side either way. The
  // ref is what stops React's double-invoke in development spending the token
  // twice, which would leave the second attempt reporting a failure over a
  // connection that succeeded.
  const attempted = useRef(false);

  useEffect(() => {
    if (!handshake || attempted.current) return;
    attempted.current = true;
    onHandshakeSpent?.(true);
    confirmConnect
      .mutateAsync({ handshake })
      .then(() => onConfirmErrorChange(null))
      .catch((error: unknown) => {
        // The API answers a spent, expired or other chapter's token with one
        // 400, which only a fresh authorization gets past. Any other failure
        // may have left the token unspent (see `onHandshakeSpent`).
        if (statusOf(error) !== 400) onHandshakeSpent?.(false);
        onConfirmErrorChange(
          getErrorMessage(
            error,
            "That Discord authorization could not be confirmed for this chapter.",
          ),
        );
      });
  }, [handshake, confirmConnect, onHandshakeSpent, onConfirmErrorChange]);

  async function startConnect() {
    try {
      const result = await beginConnect.mutateAsync({
        return_path: DISCORD_CONNECT_RETURN_PATH,
      });
      const url = (result as { authorize_url?: string } | undefined)
        ?.authorize_url;
      if (!url) throw new Error("The API did not return a Discord link.");
      // A full navigation, not a popup: Discord's consent screen refuses to
      // render in an iframe, and a popup is the thing browsers block.
      window.location.assign(url);
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(
          error,
          "Could not start the Discord connection.",
        ),
      });
    }
  }

  // The nested family: the wizard sits flush on /discord-import, where the
  // whole-screen states would redraw the card the route deleted. `sole` on
  // the spinners, which are the screen's only async state and were announced
  // as `LoadingState`. The error and offline titles stay `<p>`s, under the
  // step's own heading.
  if (confirmConnect.isPending) {
    return <NestedLoading sole message="Confirming your Discord server…" />;
  }

  // Offline with nothing read, both ways a read goes offline
  // (`readIsOffline` in async-states.tsx): it pauses, and used to sit on
  // "Checking…" for as long as the link was down; or, with the API
  // unreachable, it fails, which read as a failure to check rather than as
  // being offline.
  if (readIsOffline(isOffline, connection)) {
    return (
      <NestedOffline
        title="Can't check Discord offline"
        description="Reconnect to check whether your server is connected."
        onRetry={() => void connection.refetch()}
      />
    );
  }

  if (connection.isPending) {
    return (
      <NestedLoading sole message="Checking whether Discord is connected…" />
    );
  }

  // `useDiscordConnection` sets `retry: false`, so a 500 or a dropped request
  // ends the query in `isError` rather than `isPending`. Without this branch it
  // fell through to the "not connected" pitch — telling a chapter that IS
  // connected to add the bot again, with no retry and no sign anything failed.
  // It used `ErrorState`'s defaults, "Unable to load data", which name nothing.
  // Only with nothing read: `staleTime: 0` refetches on every mount, and a
  // refetch that fails keeps the last answer, which the branches below show.
  if (connection.isError && connection.data === undefined) {
    return (
      <NestedError
        title="Couldn't check the Discord connection"
        description="Retry to see whether your server is connected."
        onRetry={() => void connection.refetch()}
      />
    );
  }

  // A refetch that failed keeps the last answer above, which may no longer
  // hold (the bot removed elsewhere since), so say it is the last one.
  const staleNotice = (
    <StaleReadNotice
      stale={connection.isError && connection.data !== undefined}
      message="Couldn't recheck the Discord connection. This is the last answer that loaded."
      onRetry={() => void connection.refetch()}
    />
  );

  if (connected) {
    return (
      <div className="space-y-4">
        {staleNotice}
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">
            Connected to {connection.data?.guild_name ?? "your Discord server"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {connection.data?.connected_discord_username
              ? `Authorized by ${connection.data.connected_discord_username}.`
              : "Authorized."}{" "}
            Frapp was added with permission to view channels and read their
            history, and nothing else. It can do more only if you give it a role
            that allows more.
          </p>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">
            Give the bot access to the channels you want to import
          </p>
          <p className="text-sm text-muted-foreground">
            Discord shows the Frapp bot only the channels its roles can see, and
            most servers hide their channels from new members. Before Frapp
            reads your server, give the bot a role that can see every channel
            you want to import: in Discord, open{" "}
            <strong className="font-medium text-foreground">
              Server Settings → Members → Frapp
            </strong>{" "}
            and add the role.
          </p>
          <p className="text-sm text-muted-foreground">
            A role that can also moderate or manage the server lends those
            powers to the bot, so take the role off Frapp once the import has
            finished. To keep the bot read-only instead, allow the Frapp role
            View Channel and Read Message History on each channel (Edit Channel
            → Permissions), or on a category for the channels still synced to
            it. Anything it still cannot see is listed after the scan, and you
            can scan again.
          </p>
          <label className="flex cursor-pointer items-start gap-3 pt-1 text-sm">
            <span className={dashboardCheckboxHitAreaClassName}>
              <input
                type="checkbox"
                className={dashboardTableCheckboxClassName}
                checked={accessGiven}
                onChange={(event) => onAccessGivenChange(event.target.checked)}
              />
            </span>
            <span>
              I have given the Frapp bot a role that can see the channels I want
              to import.
            </span>
          </label>
        </div>

        <p className="text-sm text-muted-foreground">
          Continue to tell your chapter what you are about to do, then choose
          where each channel lands.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onConnected} disabled={!accessGiven}>
            Continue
          </Button>
          <Button
            variant="ghost"
            onClick={() => void startConnect()}
            disabled={beginConnect.isPending || withdrawn}
          >
            Connect a different server
          </Button>
        </div>
        {withdrawn ? (
          <p className="text-sm text-muted-foreground">
            Connecting a different server is not available here right now. This
            server stays connected.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {staleNotice}
      {confirmError ? (
        // Shown rather than toasted: the admin is looking at a step that says
        // "not connected" after having just authorized, and needs the reason
        // in front of them — most often that they authorized while a different
        // chapter was active.
        <div className="rounded-lg border border-destructive/40 bg-destructive-tint p-3">
          <p className="text-sm font-medium">Could not confirm that server</p>
          <p className="mt-1 text-sm text-muted-foreground">{confirmError}</p>
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Add the Frapp bot to your Discord server. Discord will ask you which
        server, and will only allow it if you have the{" "}
        <strong className="font-medium text-foreground">Manage Server</strong>{" "}
        permission there.
      </p>
      <p className="text-sm text-muted-foreground">
        The bot asks for two permissions and no others:{" "}
        <strong className="font-medium text-foreground">View Channels</strong>{" "}
        and{" "}
        <strong className="font-medium text-foreground">
          Read Message History
        </strong>
        . With only those it cannot send messages, change anything, or remove
        anyone. You can remove it from your server at any time. After adding it,
        you will give it a role that can see the channels to import.
      </p>

      {withdrawn ? (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">
            Connecting Discord is not available here right now
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Go back and choose Upload an export, which does the same job.
          </p>
        </div>
      ) : null}

      <Button
        onClick={() => void startConnect()}
        disabled={beginConnect.isPending || withdrawn}
      >
        {beginConnect.isPending ? "Opening Discord…" : "Add to Server"}
      </Button>
    </div>
  );
}
