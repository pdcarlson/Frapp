import { cookies } from "next/headers";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ChapterPresenceProvider } from "@/lib/providers/chapter-presence-provider";
import {
  NAV_COLLAPSED_COOKIE,
  parseNavCollapsed,
} from "@/components/layout/nav-collapse";

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

  // Presence is published for as long as the app is open on any dashboard
  // route, not only while the Directory is mounted — otherwise the dot would
  // mean "has the Directory open" and everyone in Chat would render Offline.
  return (
    <ChapterPresenceProvider>
      <DashboardShell defaultNavCollapsed={navCollapsed}>
        {children}
      </DashboardShell>
    </ChapterPresenceProvider>
  );
}
