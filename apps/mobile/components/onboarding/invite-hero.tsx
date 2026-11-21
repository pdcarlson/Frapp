import { StyleSheet, Text, View } from "react-native";
import { inviteCardLine, type InviteDetails } from "@repo/hooks";
import { normalizeAccentInput } from "@repo/hooks/chapter-identity";
import { chapterInitials } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { eyebrowStyle } from "@/components/eyebrow";
import { ChapterMarkTile } from "@/components/onboarding/chapter-mark-tile";
import {
  SkeletonRegion,
  SkeletonText,
  SkeletonBlock,
} from "@/components/state-block";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** The tile's size on the card: web's crest tile at card size (56). */
const MARK_SIZE = 56;

function Mark({ details }: { details: InviteDetails }) {
  return (
    // The chapter's name beside it says who this is, so a screen reader
    // skips the mark.
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <ChapterMarkTile
        text={details.mark_text ?? chapterInitials(details.chapter_name)}
        accent={normalizeAccentInput(details.accent_color)}
        size={MARK_SIZE}
      />
    </View>
  );
}

/**
 * The top of the phone's invite screen (#5625), the same card web `/join`
 * leads with (`apps/web/components/join/invite-hero.tsx`): whose chapter it
 * is and who sent it, before anything is asked. Discord's and GroupMe's
 * invite screens lead the same way, because that is what decides whether
 * someone taps on.
 *
 * The chapter's name is the screen's header for a screen reader.
 */
export function InviteHero({
  details,
  eyebrow = "You're invited to join",
}: {
  details: InviteDetails;
  eyebrow?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const line = inviteCardLine(details);
  return (
    <View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <View style={styles.chapterRow}>
        <Mark details={details} />
        <View style={styles.chapterText}>
          <Text accessibilityRole="header" style={styles.chapterName}>
            {details.chapter_name}
          </Text>
          {details.university ? (
            <Text style={styles.university} numberOfLines={1}>
              {details.university}
            </Text>
          ) : null}
        </View>
      </View>
      {line || details.role ? (
        <View style={styles.facts}>
          {line ? (
            <View style={styles.factRow}>
              <Text style={styles.factText}>{line}</Text>
            </View>
          ) : null}
          {line && details.role ? <View style={styles.rule} /> : null}
          {details.role ? (
            <View style={[styles.factRow, styles.factPair]}>
              <Text style={styles.factLabel}>You&apos;ll join as</Text>
              <Text style={styles.factValue} numberOfLines={1}>
                {details.role}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A dead link's top (#5625): what happened is the header, and the chapter
 * and its sender stay on the card, so the member knows exactly whom to ask.
 */
export function DeadInviteHero({
  details,
  title,
  sent,
}: {
  details: InviteDetails;
  title: string;
  sent: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <View style={[styles.facts, styles.deadCard]}>
        <Mark details={details} />
        <View style={styles.chapterText}>
          <Text style={styles.deadName} numberOfLines={1}>
            {details.chapter_name}
          </Text>
          {details.university ? (
            <Text style={styles.university} numberOfLines={1}>
              {details.university}
            </Text>
          ) : null}
          {sent ? <Text style={styles.sent}>{sent}</Text> : null}
        </View>
      </View>
    </View>
  );
}

/** The hero's shape while the invite is read, so nothing jumps when it lands. */
export function InviteHeroSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const role = tokens.typography.role;
  return (
    <SkeletonRegion label="Opening your invite">
      <SkeletonText role={role.caption} width={150} />
      <View style={styles.chapterRow}>
        <SkeletonBlock
          width={MARK_SIZE}
          height={MARK_SIZE}
          radius={Math.round(MARK_SIZE / 4)}
        />
        <View style={styles.chapterText}>
          <SkeletonText role={role.headline} width="75%" />
          <SkeletonText role={role.body} width="50%" />
        </View>
      </View>
      <View style={styles.skeletonFacts}>
        <SkeletonBlock width="100%" height={48} radius={tokens.radius.card} />
      </View>
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    eyebrow: {
      ...eyebrowStyle(tokens),
      // House gold: before joining there is no chapter accent to take.
      color: tokens.color.gold.house,
    },
    chapterRow: {
      marginTop: tokens.spacing.md,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.lg,
    },
    chapterText: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    chapterName: {
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    university: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    facts: {
      marginTop: tokens.spacing.lg + tokens.spacing.xs,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
    },
    factRow: {
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
    },
    factPair: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.color.border.hairline,
    },
    factText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    factLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    factValue: {
      flexShrink: 1,
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    deadCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      padding: tokens.spacing.lg,
    },
    deadName: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    sent: {
      marginTop: tokens.spacing.xs,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    skeletonFacts: {
      marginTop: tokens.spacing.lg + tokens.spacing.xs,
    },
  });
}
