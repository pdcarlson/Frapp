import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useChannels } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  displayChannelLabel,
  selectJoinedPublicChannels,
} from "@/lib/onboarding/welcome-channels";
import { SkeletonRegion, SkeletonText } from "@/components/state-block";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The public channels a member is already in, as a card: s03 shows it to a
 * member who just joined, and chapter setup's live step to the officer who
 * just created the chapter (#3351). Both read `GET /v1/channels` for the
 * active chapter; `#alumni` is role-gated, so only the public ones are named
 * (`selectJoinedPublicChannels`).
 *
 * `trailing` is the word on the right of each row: "joined" for a member,
 * "ready" for a chapter that was only just made.
 */
export function JoinedChannelsCard({
  trailing = "joined",
}: {
  trailing?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const channels = useChannels();
  const joined = useMemo(
    () => selectJoinedPublicChannels(channels.data),
    [channels.data],
  );

  return (
    <View style={styles.card}>
      {channels.isPending ? (
        <JoinedChannelsSkeleton />
      ) : channels.isError ? (
        <Text style={styles.hint}>
          We couldn&apos;t load your channels. They&apos;ll be waiting in chat.
        </Text>
      ) : joined.length === 0 ? (
        <Text style={styles.hint}>
          You&apos;re in the chapter. Open chat to see your channels.
        </Text>
      ) : (
        joined.map((channel, index) => (
          <View key={channel.id}>
            {index > 0 ? <View style={styles.rule} /> : null}
            <View style={styles.row}>
              <Text style={styles.hash}>#</Text>
              <Text style={styles.name}>
                {displayChannelLabel(channel.name).replace(/^#/, "")}
              </Text>
              <Text style={styles.trailing}>{trailing}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

/** Name widths, cycled, so the placeholder rows don't read as a grid. */
const SKELETON_NAME_WIDTHS = ["38%", "52%", "30%"] as const;

/**
 * The card's loading state: channel rows on the loaded rows' own styles, the
 * `#`'s slot, the name, and the trailing word, split by the same rules.
 */
function JoinedChannelsSkeleton({ rows = 3 }: { rows?: number }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, label, title } = tokens.typography.role;

  return (
    <SkeletonRegion label="Loading your channels">
      {Array.from({ length: rows }, (_, index) => (
        <View key={index}>
          {index > 0 ? <View style={styles.rule} /> : null}
          <View style={styles.row}>
            <SkeletonText role={title} width={tokens.spacing.md} />
            <View style={styles.name}>
              <SkeletonText
                role={label}
                width={
                  SKELETON_NAME_WIDTHS[index % SKELETON_NAME_WIDTHS.length]!
                }
              />
            </View>
            <SkeletonText role={caption} width={tokens.spacing["2xl"]} />
          </View>
        </View>
      ))}
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      paddingVertical: tokens.spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tint(tokens.color.text.foreground, 0.08),
      marginHorizontal: tokens.spacing.md,
    },
    hash: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.gold.house,
    },
    name: {
      flex: 1,
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    trailing: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    hint: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
    },
  });
}
