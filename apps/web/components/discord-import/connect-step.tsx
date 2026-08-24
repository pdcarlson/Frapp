"use client";

import { useBeginDiscordConnect, useDiscordConnection } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/**
 * Where the browser comes back to after Discord.
 *
 * Carries `wizard=bot` so the page can reopen the wizard on this step instead
 * of dropping the admin back on the import list with no idea whether it worked.
 * The API validates this against its own app origin before storing it, so it
 * cannot be turned into an off-site redirect.
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
export function ConnectStep({ onConnected }: { onConnected: () => void }) {
  const { toast } = useToast();
  const connection = useDiscordConnection();
  const beginConnect = useBeginDiscordConnect();

  const connected = connection.data?.connected === true;

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

  if (connection.isPending) {
    return (
      <p className="text-sm text-muted-foreground">
        Checking whether Discord is connected…
      </p>
    );
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
