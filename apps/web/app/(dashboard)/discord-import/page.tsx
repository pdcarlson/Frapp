import { Suspense } from "react";
import { DiscordImportPage } from "@/components/discord-import/discord-import-page";

export const metadata = { title: "Discord Import — Signet" };

export default function DiscordImport() {
  // `DiscordImportPage` reads `useSearchParams()` (the `?discord=` outcome the
  // OAuth callback redirects back with), which Next requires to sit under a
  // Suspense boundary — matching `settings`, `directory`, `billing`, `sign-in`,
  // `sign-up` and `join`. Without it the route bails out of prerendering and
  // takes the whole web build down with it, and CI does not build apps/web.
  return (
    <Suspense fallback={null}>
      <DiscordImportPage />
    </Suspense>
  );
}
