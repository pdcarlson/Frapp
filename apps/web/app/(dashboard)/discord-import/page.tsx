import { redirect } from "next/navigation";
import {
  DISCORD_IMPORT_SETTINGS_PATH,
  settingsRedirectPath,
} from "@/components/settings/settings-paths";

/**
 * Discord import moved inside Chapter settings' Chat page (#3837); this route
 * only redirects old links there. Every param comes along: the API's default
 * Discord return path is still this route, and it lands with `?discord=` (the
 * outcome) and `?handshake=` (spent by the page, then stripped).
 */
export default async function DiscordImport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(
    settingsRedirectPath(DISCORD_IMPORT_SETTINGS_PATH, await searchParams),
  );
}
