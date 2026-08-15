import { Link } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { asRoute } from "@/lib/href";
import { typeRole, useFrappTheme } from "@/lib/theme";

type NavTileProps = {
  href: string;
  title: string;
  description: string;
  accessibilityHint?: string;
};

export function NavTile({
  href,
  title,
  description,
  accessibilityHint,
}: NavTileProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <Link href={asRoute(href)} asChild>
      <Pressable
        style={styles.tile}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={accessibilityHint ?? description}
      >
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileDescription}>{description}</Text>
      </Pressable>
    </Link>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    tile: {
      minHeight: tokens.touch.minimum,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.xs,
      justifyContent: "center",
    },
    tileTitle: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    tileDescription: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
  });
}
