import { cookies } from "next/headers";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ChapterPresenceProvider } from "@/lib/providers/chapter-presence-provider";
import {
  NAV_COLLAPSED_COOKIE,
  parseNavCollapsed,
} from "@/components/layout/nav-collapse";
import { ChapterAccentStyle } from "@/lib/theme/chapter-accent-style";
import { readCachedAccentPaint } from "@/lib/theme/server-accent";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read the nav collapse preference here, on the server, so the very first
  // paint is already the right width. Doing it in a client effect would render
  // the 220px nav and then snap to the 56px rail after hydration on every
  // route, which is exactly the layout shift the first-paint contract budgets
  // to zero.
  const cookieStore = await cookies();
  const navCollapsed = parseNavCollapsed(
    cookieStore.get(NAV_COLLAPSED_COOKIE)?.value,
  );

  // The same argument, for colour rather than width: the chapter accent
  // otherwise arrives from `GET /v1/chapters/current` long after `signet.css`
  // has painted the house default, so a chapter with its own accent opens in
  // another chapter's gold. `lib/theme/server-accent.ts` reads the last known
  // accent for the member and chapter *this request* is authenticated as, so
  // the markup already carries it. `cookies()` is request-memoised, so reading
  // the jar a second time in there costs nothing.
  const accentPaint = await readCachedAccentPaint();

  // Presence is published for as long as the app is open on any dashboard
  // route, not only while the Directory is mounted — otherwise the dot would
  // mean "has the Directory open" and everyone in Chat would render Offline.
  return (
    <ChapterPresenceProvider>
      {/*
        First child of the dashboard subtree on purpose. A stylesheet applies
        from wherever it is parsed, so anything rendered above it could paint
        once in the house default before this rule exists — and everything the
        accent touches (the nav's active item, the primary button, the member's
        own chat bubbles) is below.
      */}
      <ChapterAccentStyle paint={accentPaint} />
      <DashboardShell defaultNavCollapsed={navCollapsed}>
        {children}
      </DashboardShell>
    </ChapterPresenceProvider>
  );
}
