"use client";

import { useEffect, useRef, useState } from "react";
import {
  useBeginDiscordConnect,
  useConfirmDiscordConnect,
  useDiscordConnection,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/shared/async-states";
import { useToast } from "@/hooks/use-toast";
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
 * never sees, pastes, or stores a token. They authorize the Signet bot through
 * Discord's ordinary "Add to Server" screen, and what Signet keeps afterwards is
 * a server id — a public number that does nothing without the install behind it.
 *
 * Discord will only let this finish if the person doing it has **Manage Server**
 * on the server they pick. That is checked by Discord and re-read by the API
 * under the authorizing account's own token; it is not something the browser
 * asserts.
 */
export function ConnectStep({
  onConnected,
  handshake = null,
}: {
  onConnected: () => void;
  /**
   * The one-time token the OAuth callback put on the redirect.
   *
   * Present exactly when this browser is the one that just completed the
   * authorization. Confirming is what actually links the server — the callback
   * parks it and links nothing, so that an authorize URL completed by somebody
   * else's Discord admin cannot attach their server to whoever generated it.
   */
  handshake?: string | null;
}) {
  const { toast } = useToast();
  const connection = useDiscordConnection();
  const beginConnect = useBeginDiscordConnect();
  const confirmConnect = useConfirmDiscordConnect();

  const connected = connection.data?.connected === true;

  // Confirmed automatically, and exactly once. The admin who started this in
  // this chapter has nothing to decide — their session and the parked guild
  // already agree, and the chapter check happens server-side either way. The
  // ref is what stops React's double-invoke in development spending the token
  // twice, which would leave the second attempt reporting a failure over a
  // connection that succeeded.
  const attempted = useRef(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (!handshake || attempted.current) return;
    attempted.current = true;
    confirmConnect
      .mutateAsync({ handshake })
      .then(() => setConfirmError(null))
      .catch((error: unknown) => {
        setConfirmError(
          getErrorMessage(
            error,
            "That Discord authorization could not be confirmed for this chapter.",
          ),
        );
      });
  }, [handshake, confirmConnect]);

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

  if (confirmConnect.isPending) {
    return <LoadingState message="Confirming your Discord server…" />;
  }

  if (connection.isPending) {
    return <LoadingState message="Checking whether Discord is connected…" />;
  }

  // `useDiscordConnection` sets `retry: false`, so a 500 or a dropped request
  // ends the query in `isError` rather than `isPending`. Without this branch it
  // fell through to the "not connected" pitch — telling a chapter that IS
  // connected to add the bot again, with no retry and no sign anything failed.
  if (connection.isError) {
    return <ErrorState onRetry={() => void connection.refetch()} />;
  }

  if (connected) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">
            Connected to {connection.data?.guild_name ?? "your Discord server"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {connection.data?.connected_discord_username
              ? `Authorized by ${connection.data.connected_discord_username}.`
              : "Authorized."}{" "}
            Signet can read channel history in this server. It cannot post,
            edit, or delete anything.
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          Continue to tell your chapter what you are about to do, then choose
          where each channel lands.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onConnected}>Continue</Button>
          <Button
            variant="ghost"
            onClick={() => void startConnect()}
            disabled={beginConnect.isPending}
          >
            Connect a different server
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {confirmError ? (
        // Shown rather than toasted: the admin is looking at a step that says
        // "not connected" after having just authorized, and needs the reason
        // in front of them — most often that they authorized while a different
        // chapter was active.
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium">Could not confirm that server</p>
          <p className="mt-1 text-sm text-muted-foreground">{confirmError}</p>
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Add the Signet bot to your Discord server. Discord will ask you which
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
        . It cannot send messages, change anything, or remove anyone. You can
        remove it from your server at any time.
      </p>

      <Button
        onClick={() => void startConnect()}
        disabled={beginConnect.isPending}
      >
        {beginConnect.isPending ? "Opening Discord…" : "Add to Server"}
      </Button>
    </div>
  );
}
