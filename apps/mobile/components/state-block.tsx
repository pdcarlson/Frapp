import { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The skeleton / empty / error family, in one place.
 *
 * `spec/ui/design-system/components.md` §10 specs these as one family that is
 * "clearly distinct at a glance", and `spec/ui/mobile/README.md` requires every
 * screen to ship all three — but until now no screen had a shared
 * implementation to reach for, so five of them grew their own byte-identical
 * `stateBlock` / `stateTitle` / `stateBody` / `retryButton` style blocks. That
 * duplication is why the drawn anatomy was never built (no icon tile, no
 * semantic error border) and why the retry button drifted below the 44pt
 * minimum in the newest copies.
 *
 * The six More-hub screens use these. The existing copies in the chat, events
 * and check-in screens are left alone deliberately — migrating them is a
 * mechanical change with its own review surface, tracked separately.
 *
 * ## Why there is no pull-to-refresh anywhere here
 *
 * `ErrorState` takes an explicit `onRetry` because `ScreenShell` owns the
 * `ScrollView` and is frozen under #937's hotspot protocol, so no screen can
 * attach a `RefreshControl`, and nothing wires `onlineManager`. Without a retry
 * control a blip at launch leaves a screen dead until a force-quit.
 */

type StateBlockProps = {
  title: string;
  body: string;
};

/**
 * Loading.
 *
 * §10 asks for a content-shaped shimmer — "no spinner-in-a-box" — and this is
 * content-shaped but **not** animated. The specified sweep is a 90° linear
 * gradient, and there is no gradient primitive in this app: `expo-linear-gradient`
 * is not a dependency and `package.json` is frozen, so adding one is an
 * integrator PR rather than part of a screen slice.
 *
 * TODO-DESIGN: shimmer sweep per components.md §10 (elevated at 25%/75%,
 * highlight `#332E26` at 50%, 260px background-size, 1.4s linear, phase-shared
 * across blocks) once a gradient dependency lands. Nearest pattern used: static
 * neutral blocks at the specified shapes.
 */
export function SkeletonLines({
  lines = 3,
  showTile = false,
}: {
  /** Text rows to draw. Widths cycle through the ~45–70% range §10 specifies. */
  lines?: number;
  /** Draw a leading control-sized block, for a list whose rows carry an avatar. */
  showTile?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // `as const` so each stays a percentage literal — RN's `DimensionValue`
  // accepts `` `${number}%` ``, not a widened `string`.
  const widths = ["70%", "45%", "60%", "52%"] as const;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={styles.card}
    >
      {showTile ? <View style={styles.skeletonTile} /> : null}
      {Array.from({ length: lines }, (_, index) => (
        <View
          key={index}
          style={[
            styles.skeletonLine,
            { width: widths[index % widths.length] },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * Empty — "inviting, never alarming" (§10). Accent and neutral only; a semantic
 * hue here would read as a fault when nothing is wrong.
 */
export function EmptyState({
  title,
  body,
  glyph = "+",
  action,
}: StateBlockProps & {
  /**
   * A single character standing in for the drawn feature glyph.
   *
   * TODO-DESIGN: §10 calls for a duotone feature glyph from iconography.md.
   * The app's only transcribed glyph set is the four tab icons
   * (`components/tab-glyphs.tsx`); the per-feature set has not been drawn into
   * code. Nearest pattern used: the accent-tinted tile with a text glyph.
   */
  glyph?: string;
  action?: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);

  return (
    <View style={styles.card}>
      <View style={[styles.tile, { backgroundColor: tint(accent) }]}>
        <Text style={[styles.glyph, { color: accent }]}>{glyph}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action}
    </View>
  );
}

/**
 * Error — the one surface allowed a semantic border (§10). Never takes the
 * chapter accent: a chapter's colour saying "something failed" is exactly the
 * confusion the semantic palette exists to prevent.
 */
export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel = "Try again",
  isRetrying = false,
}: StateBlockProps & {
  onRetry?: () => void;
  retryLabel?: string;
  isRetrying?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View style={[styles.card, styles.errorCard]}>
      <View style={styles.errorTile}>
        <Text style={styles.errorGlyph}>!</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          accessibilityState={{ disabled: isRetrying }}
          disabled={isRetrying}
          hitSlop={tokens.spacing.sm}
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retry,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.retryText}>
            {isRetrying ? "Retrying…" : retryLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * "No chapter selected" — its own state because it is neither empty nor an
 * error, and because on this app it is the *common* case rather than an edge
 * one: `custom_access_token_hook` is not enabled in production (#805), so no
 * token carries an `active_chapter_id` claim and every chapter-scoped query
 * stays disabled. A spinner there would hang forever and an error would blame
 * the network for a configuration gap.
 *
 * Points at the Chapter row on More, which is the only entry to the picker
 * (`spec/ui/mobile/navigation.md`).
 */
export function NoChapterState({ noun }: { noun: string }) {
  return (
    <EmptyState
      glyph="⌂"
      title="No chapter selected"
      body={`Choose a chapter from More → Chapter to see ${noun}.`}
    />
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
      alignItems: "center",
    },
    errorCard: {
      // The sanctioned semantic border, and the only one in the family.
      borderColor: tint(tokens.color.semantic.destructive, 0.28),
    },
    tile: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.card,
      alignItems: "center",
      justifyContent: "center",
    },
    errorTile: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.card,
      alignItems: "center",
      justifyContent: "center",
      // `tint`'s default alpha is 0.13, which is the danger fill §10 specifies.
      backgroundColor: tint(tokens.color.semantic.destructive),
    },
    glyph: {
      ...typeRole(tokens.typography.role.title),
    },
    errorGlyph: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.semantic.destructive,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
      textAlign: "center",
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
      // §10 caps the body at ~220px so it never runs the full card width.
      maxWidth: 220,
    },
    retry: {
      marginTop: tokens.spacing.xs,
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      paddingHorizontal: tokens.spacing.lg,
    },
    retryText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    pressed: {
      opacity: 0.7,
    },
    skeletonTile: {
      alignSelf: "flex-start",
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.surface.popover,
    },
    skeletonLine: {
      alignSelf: "flex-start",
      height: tokens.spacing.md,
      // TODO-DESIGN: §10 specifies radius 6 for skeleton text lines. `chip` (8)
      // is the nearest token; a raw 6 would be a hard-coded value, which
      // foundations.md bans.
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
    },
  });
}
