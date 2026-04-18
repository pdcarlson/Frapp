import { ActivityFeed } from "@/components/home/activity-feed";
import { OverviewStatCards } from "@/components/home/overview-stat-cards";
import { QuickActionsCard } from "@/components/home/quick-actions-card";

export const metadata = {
  title: "Home · Frapp",
  description: "Chapter overview, activity, and quick actions for the active chapter.",
};

export default function Home() {
  return (
    <>
      <OverviewStatCards />

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <ActivityFeed />

        <QuickActionsCard />
      </section>
    </>
  );
}
