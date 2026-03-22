import { Link } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { FrappTokens } from "@repo/theme/tokens";
import { asRoute } from "@/lib/href";
import { useFrappTheme } from "@/lib/theme";

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

function createStyles(tokens: FrappTokens) {
  return StyleSheet.create({
    tile: {
      minHeight: 52,
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: 6,
      justifyContent: "center",
    },
    tileTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
    tileDescription: {
      fontSize: 14,
      lineHeight: 20,
      color: tokens.color.text.secondary,
    },
  });
}
