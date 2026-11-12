import { redirect } from "next/navigation";
import {
  CHAT_SETTINGS_PATH,
  settingsRedirectPath,
} from "@/components/settings/settings-paths";

/**
 * Chat admin moved inside Chapter settings' Chat page (#3837); this route only
 * redirects old links there. `?channel=<id>` still opens that channel's own
 * settings.
 */
export default async function ChatAdmin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(settingsRedirectPath(CHAT_SETTINGS_PATH, await searchParams));
}
