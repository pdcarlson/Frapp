import { androidAssetLinks, appLinksResponse } from "@/lib/app-links";

/** Android App Links for invite links (#4002). Built in `lib/app-links.ts`. */
export const dynamic = "force-static";

export function GET(): Response {
  return appLinksResponse(
    androidAssetLinks(process.env.NEXT_PUBLIC_ANDROID_APP_CERT_SHA256),
  );
}
