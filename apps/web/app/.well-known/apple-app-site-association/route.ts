import {
  appLinksResponse,
  appleAppSiteAssociation,
  deploymentNativeApp,
} from "@/lib/app-links";

/** iOS universal links for invite and check-in links (#4002), naming this
 * deployment's own app. Built in `lib/app-links.ts`. */
export const dynamic = "force-static";

export function GET(): Response {
  return appLinksResponse(
    appleAppSiteAssociation(
      process.env.NEXT_PUBLIC_APPLE_TEAM_ID,
      deploymentNativeApp(),
    ),
  );
}
