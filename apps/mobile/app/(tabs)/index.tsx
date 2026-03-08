import { InfoCard, ScreenShell } from "@/components/screen-shell";

export default function HomeScreen() {
  return (
    <ScreenShell
      title="Activity Feed"
      subtitle="Everything your chapter needs to notice right now, without scrolling through noise."
    >
      <InfoCard
        badge="Upcoming"
        title="Chapter Meeting • Tonight 6:00 PM"
        body="42 members confirmed. Attendance points auto-award is enabled."
      />
      <InfoCard
        badge="Announcement"
        title="Exec update posted in #announcements"
        body="Treasurer shared dues timeline and next action deadlines."
      />
      <InfoCard
        badge="Milestone"
        title="You moved to #4 on the leaderboard"
        body="9 points behind #3. One event check-in can close the gap."
      />
    </ScreenShell>
  );
}
