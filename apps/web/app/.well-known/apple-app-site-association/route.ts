import { appLinksResponse, appleAppSiteAssociation } from "@/lib/app-links";

/** iOS universal links for invite links (#4002). Built in `lib/app-links.ts`. */
export const dynamic = "force-static";

export function GET(): Response {
  return appLinksResponse(
    appleAppSiteAssociation(process.env.NEXT_PUBLIC_APPLE_TEAM_ID),
  );
}
