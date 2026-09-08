import { permanentRedirect } from "next/navigation";
import { buildJoinUrl } from "../../lib/auth-urls";

/**
 * The marketing origin has no join UI. Forward to the web app with the
 * invite query intact (`?token=` / `?invite=` / `?code=`). `buildJoinUrl`
 * refuses a public `http:` base before copying that query, and a Vercel
 * production deploy refuses a non-production app origin.
 */
export default async function JoinRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  permanentRedirect(
    buildJoinUrl(process.env.NEXT_PUBLIC_APP_URL, params, {
      vercelEnv: process.env.VERCEL_ENV,
    }),
  );
}
