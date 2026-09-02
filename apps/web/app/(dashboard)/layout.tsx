import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ChapterPresenceProvider } from "@/lib/providers/chapter-presence-provider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Presence is published for as long as the app is open on any dashboard
  // route, not only while the Directory is mounted — otherwise the dot would
  // mean "has the Directory open" and everyone in Chat would render Offline.
  return (
    <ChapterPresenceProvider>
      <DashboardShell>{children}</DashboardShell>
    </ChapterPresenceProvider>
  );
}
