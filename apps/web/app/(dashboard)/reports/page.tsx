import { redirect } from "next/navigation";
import {
  REPORTS_SETTINGS_PATH,
  settingsRedirectPath,
} from "@/components/settings/settings-paths";

/**
 * Reports moved inside Chapter settings' Reports page (#3837); this route only
 * redirects old links there.
 */
export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(settingsRedirectPath(REPORTS_SETTINGS_PATH, await searchParams));
}
