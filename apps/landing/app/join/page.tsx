import { permanentRedirect } from "next/navigation";
import { buildJoinUrl } from "../../lib/auth-urls";

/**
 * The marketing origin has no join UI. Forward to the web app with the
 * invite query intact (`?token=` / `?invite=` / `?code=`).
 */
export default async function JoinRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  permanentRedirect(buildJoinUrl(process.env.NEXT_PUBLIC_APP_URL, params));
}
