import { redirect } from "next/navigation";
import {
  STUDY_ZONES_SETTINGS_PATH,
  settingsRedirectPath,
} from "@/components/settings/settings-paths";

/**
 * Study zones moved inside Chapter settings' Study zones page, which lists
 * them and opens the map editor in place; this route only redirects old
 * links there. `from` is kept: store builds still open `/geofences?from=app`
 * from the setup list, and it tells the dashboard not to suggest the app.
 */
export default async function Geofences({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(settingsRedirectPath(STUDY_ZONES_SETTINGS_PATH, await searchParams));
}
