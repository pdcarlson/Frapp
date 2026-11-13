import { APP_LINK_PATHS, NATIVE_APP_ID } from "@repo/validation";

/**
 * The two files that let an invite link open the app (#4002).
 *
 * iOS opens `app.frapp.live/join?…` in the app only when this origin serves
 * `/.well-known/apple-app-site-association` naming `<Team ID>.live.frapp.mobile`
 * and the binary carries `applinks:app.frapp.live`. Android opens it when this
 * origin serves `/.well-known/assetlinks.json` with the SHA-256 of the key that
 * signs the installed app and the binary's intent filter is `autoVerify`. Both
 * halves are needed. The binary's half is `apps/mobile/app.json`, and no store
 * build carries it yet (#4002): until one does, these files open nothing.
 *
 * The identifiers come from the environment, not the repo, which records
 * neither: `eas.json` names no `appleTeamId`, and the Play app-signing
 * fingerprint lives in Play Console (`ENV_REFERENCE.md` says where to find
 * each). Neither is a secret: both files are public by design. Unset, the route
 * answers 404, which is what the origin answered before these routes existed,
 * so staging and local need nothing.
 *
 * Both are `NEXT_PUBLIC_*` names because both values are public, and because
 * a deployment's runtime environment carries no app config: Next inlines
 * `NEXT_PUBLIC_*` at build (`scripts/ci/lib/vercel-build-env.mjs` lists both
 * as optional), so a changed value needs a web deploy. Each route is
 * prerendered (`dynamic = "force-static"`), so serving it runs no function.
 */

/** What each claimed path is for, as the file says it to a reader. */
const APP_LINK_COMMENTS: Record<(typeof APP_LINK_PATHS)[number], string> = {
  "/join": "An invite link opens the app's join step (#4002)",
  "/check-in": "The check-in code a phone camera reads opens check-in",
};

/** An Apple Team ID: ten uppercase letters and digits. */
function validTeamId(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value && /^[A-Z0-9]{10}$/.test(value) ? value : null;
}

/**
 * The signing certificate fingerprints, comma-separated: Play's app-signing key
 * (every install from Play, internal testing included), and the upload key
 * when an EAS preview APK installed outside Play should open links too.
 * Normalised to the colon-separated uppercase form Google matches on; a value
 * that isn't 32 bytes of hex is dropped rather than published.
 */
function validFingerprints(raw: string | undefined): string[] {
  if (!raw) return [];
  const fingerprints: string[] = [];
  for (const part of raw.split(",")) {
    const hex = part.trim().replace(/:/g, "").toUpperCase();
    if (!/^[0-9A-F]{64}$/.test(hex)) continue;
    const formatted = hex.match(/.{2}/g)!.join(":");
    if (!fingerprints.includes(formatted)) fingerprints.push(formatted);
  }
  return fingerprints;
}

/**
 * `apple-app-site-association`, or null when the Team ID isn't set.
 *
 * `components` is the iOS 13+ form (the app's floor is far above it). Each path
 * is matched exactly, with any query, so `/join?token=…` opens the app and
 * `/joined` or `/join/x` would not.
 */
export function appleAppSiteAssociation(
  appleTeamId: string | undefined,
): object | null {
  const teamId = validTeamId(appleTeamId);
  if (!teamId) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${NATIVE_APP_ID}`],
          components: APP_LINK_PATHS.map((path) => ({
            "/": path,
            comment: APP_LINK_COMMENTS[path],
          })),
        },
      ],
    },
  };
}

/** `assetlinks.json`, or null when no valid fingerprint is set. */
export function androidAssetLinks(
  certSha256: string | undefined,
): object[] | null {
  const fingerprints = validFingerprints(certSha256);
  if (fingerprints.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: NATIVE_APP_ID,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

/**
 * The response both routes send. JSON with no redirect, which both platforms
 * require; Apple's CDN fetches the file without an extension, so the content
 * type is set explicitly. An hour of caching keeps a fixed value from taking
 * a day to reach a re-verifying device.
 */
export function appLinksResponse(body: unknown): Response {
  if (body === null) {
    return new Response("Not Found", { status: 404 });
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
