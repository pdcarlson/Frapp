import { redirect } from "next/navigation";

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
  const params = new URLSearchParams({ tab: "geofences" });
  const from = (await searchParams).from;
  if (typeof from === "string") params.set("from", from);
  redirect(`/settings?${params.toString()}`);
}
