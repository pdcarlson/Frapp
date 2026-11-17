import {
  androidAssetLinks,
  appLinksResponse,
  deploymentNativeApp,
} from "@/lib/app-links";

/** Android App Links for invite and check-in links (#4002), naming this
 * deployment's own app. Built in `lib/app-links.ts`. */
export const dynamic = "force-static";

export function GET(): Response {
  return appLinksResponse(
    androidAssetLinks(
      process.env.NEXT_PUBLIC_ANDROID_APP_CERT_SHA256,
      deploymentNativeApp(),
    ),
  );
}
