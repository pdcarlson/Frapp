import { Link } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { InfoCard, ScreenShell } from "@/components/screen-shell";
import { frappTokens } from "@repo/theme/tokens";

function NavTile({
  href,
  title,
  description,
}: {
  href:
    | "/notifications"
    | "/preferences"
    | "/task-center"
    | "/service-hours"
    | "/documents-reports";
  title: string;
  description: string;
}) {
  return (
    <Link href={href} asChild>
      <Pressable style={styles.tile}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileDescription}>{description}</Text>
      </Pressable>
    </Link>
  );
}

export default function MoreScreen() {
  return (
    <ScreenShell
      title="More"
      subtitle="Secondary chapter tools, notifications, and account controls."
    >
      <NavTile
        href="/notifications"
        title="Notification Center"
        description="Review unread activity and category-level updates."
      />
      <NavTile
        href="/preferences"
        title="Preferences"
        description="Quiet hours, theme mode, and communication defaults."
      />
      <NavTile
        href="/task-center"
        title="Task Center"
        description="Track assigned tasks, due dates, and confirmation state."
      />
      <NavTile
        href="/service-hours"
        title="Service Hours"
        description="Log philanthropy work and monitor approval queue outcomes."
      />
      <NavTile
        href="/documents-reports"
        title="Documents & Reports"
        description="Review chapter docs and export-ready reporting snapshots."
      />
      <InfoCard
        title="Coming next"
        body="Polished filters, sharing controls, and role-aware access will continue expanding in these workflows."
        badge="Roadmap"
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    padding: frappTokens.spacing.lg,
    gap: 6,
  },
  tileTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
  tileDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: frappTokens.color.text.secondary,
  },
});
