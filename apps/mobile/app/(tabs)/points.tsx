import { InfoCard, ScreenShell } from "@/components/screen-shell";

export default function PointsScreen() {
  return (
    <ScreenShell
      title="My Points"
      subtitle="Track your balance, recent transactions, and chapter rank across time windows."
    >
      <InfoCard
        badge="Current"
        title="Balance: 186 points"
        body="You gained 26 points this month from events and study sessions."
      />
      <InfoCard
        title="Leaderboard rank"
        body="#4 chapter-wide • 9 points behind #3."
      />
      <InfoCard
        badge="Recent"
        title="+10 Attendance • Chapter Meeting"
        body="Awarded today at 6:52 PM."
      />
    </ScreenShell>
  );
}
