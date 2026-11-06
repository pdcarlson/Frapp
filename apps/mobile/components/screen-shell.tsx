import { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import {
  type BackTarget,
  PinnedBackRow,
  pinnedBackClearance,
} from "@/components/back-row";
import {
  CREATE_BUTTON_SIZE,
  type CreateAction,
  FloatingCreateButton,
} from "@/components/floating-create-button";
import { FLOATING_TAB_BAR, useTabBarClearance } from "@/lib/floating-chrome";
import {
  ThemedRefreshControl,
  type ScreenRefresh,
} from "@/components/pull-to-refresh";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

type ScreenShellProps = {
  title: string;
  /**
   * The `‹ More` / `‹ Events` row above the title, on a screen reached from
   * another one (#3022, `spec/ui/mobile/navigation.md` § Back rows). A tab's
   * own screen passes none. Every state of a screen passes the same one, so a
   * deep link that lands on an error still has a way out.
   */
  back?: BackTarget;
  /**
   * A control at the far end of the back row, where the board draws s15's
   * Edit (#3387). Drawn only with `back`, pinned with it.
   */
  backAction?: ReactNode;
  /**
   * The screen's one create action, drawn as the floating glass "+" above the
   * tab bar (`FloatingCreateButton`): Tasks, Service hours, Documents.
   */
  createAction?: CreateAction;
  /**
   * Drawn before the title on the title row. Chat home passes the chapter mark
   * (`ChapterMark`), which is the one mobile surface of the chapter's logo
   * inside a chapter; chapter setup draws its own preview before the chapter
   * exists (`spec/behavior/branding.md` § Chapter mark). It used to ride in the tab
   * navigator's header, which no screen has since #2485.
   */
  titleMark?: ReactNode;
  /**
   * A line under the title, for a fact about this one item that the title
   * can't carry. Optional since #3023: the board draws one only on s07, where
   * Event details passes the event's time. A line that says what the screen is
   * for ("What you owe the chapter…") never belongs here; the owner dropped
   * those on 2026-11-04 (`spec/ui/mobile/patterns.md` § Screen headers).
   */
  subtitle?: string;
  /**
   * Trailing control rendered on the title row, right-aligned and vertically
   * centred against the title.
   *
   * The ✦ Ask pill on s04 and s06 (`spec/ui/mobile/navigation.md` § Global
   * entries outside the tab bar). A create action is not one of these: it
   * floats bottom right (`createAction`).
   * Optional, so every existing call site is unaffected.
   */
  headerAction?: ReactNode;
  /**
   * Pull-to-refresh on the shell's scroll view (#3385): `useRefetchAll` over
   * the screen's queries. The spinner stays up until it settles. Pass it for
   * the screen's whole life or not at all: adding or removing the control
   * remounts everything under the scroll view.
   */
  refresh?: ScreenRefresh;
  children: ReactNode;
};

/**
 * A page title: the headline role (24/700) at the board's -0.3 tracking, one
 * level above the card titles under it (spec/ui/mobile/patterns.md § Screen
 * headers). ScreenShell draws it; a screen that draws its own header, as s13
 * Directory does for its FlatList, spreads this rather than copying the values.
 */
export function screenTitleStyle(tokens: SignetTokens) {
  return {
    color: tokens.color.text.foreground,
    ...typeRole(tokens.typography.role.headline),
    letterSpacing: -0.3,
  };
}

/**
 * The screen frame most tab screens share: an optional back row, its title
 * row, an optional subtitle and the scrolling body. s05, s13, s18 and s22 draw their own. The
 * title is the only heading the shell draws; a screen may add its own below
 * it, as Chat home's section headers do. The tab layout draws no navigator
 * header (#2485), so the shell also takes the top safe-area inset the header
 * used to absorb.
 *
 * The title draws in `screenTitleStyle`. Which role it takes, and why, lives in
 * spec/ui/mobile/patterns.md § Screen headers.
 */
export function ScreenShell({
  title,
  back,
  backAction,
  createAction,
  titleMark,
  subtitle,
  headerAction,
  refresh,
  children,
}: ScreenShellProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // Room under the last row for the floating bar, and for the create button
  // above it when there is one, so nothing scrolls out of reach beneath them.
  const clearance =
    useTabBarClearance() +
    (createAction ? CREATE_BUTTON_SIZE + FLOATING_TAB_BAR.gap : 0);

  return (
    <View style={styles.frame}>
      {/* First in the tree so a screen reader reaches the screen's one create
          action without swiping past every row; drawn over them by zIndex. */}
      {createAction ? <FloatingCreateButton {...createAction} /> : null}
      <SafeAreaView
        style={styles.safeArea}
        edges={["top", "left", "right", "bottom"]}
      >
        {/* Unpadded, so the pinned row sits where the content starts. */}
        <View style={styles.safeArea}>
          {back ? <PinnedBackRow back={back} trailing={backAction} /> : null}
          <ScrollView
            contentContainerStyle={[
              styles.content,
              back ? { paddingTop: pinnedBackClearance(tokens) } : null,
              { paddingBottom: tokens.spacing.lg + clearance },
            ]}
            refreshControl={
              refresh ? <ThemedRefreshControl refresh={refresh} /> : undefined
            }
          >
            <View style={styles.header}>
              <View style={styles.headerRow}>
                {titleMark}
                <Text accessibilityRole="header" style={styles.title}>
                  {title}
                </Text>
                {headerAction ? (
                  <View style={styles.headerAction}>{headerAction}</View>
                ) : null}
              </View>
              {subtitle ? (
                <Text style={styles.subtitle}>{subtitle}</Text>
              ) : null}
            </View>
            {children}
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  );
}

export function InfoCard({
  title,
  body,
  badge,
}: {
  title: string;
  body: string;
  badge?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View style={styles.card}>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    frame: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    safeArea: {
      flex: 1,
    },
    content: {
      width: "100%",
      maxWidth: 880,
      alignSelf: "center",
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    header: {
      marginBottom: tokens.spacing.xs,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    title: {
      flex: 1,
      ...screenTitleStyle(tokens),
    },
    headerAction: {
      flexShrink: 0,
    },
    subtitle: {
      marginTop: tokens.spacing.xs,
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    badge: {
      alignSelf: "flex-start",
      borderRadius: tokens.radius.chip,
      backgroundColor: tint(tokens.color.semantic.info),
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
    },
    badgeText: {
      color: tokens.color.semantic.info,
      ...typeRole(tokens.typography.role.caption),
      letterSpacing: 0.2,
      textTransform: "uppercase",
    },
    cardTitle: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    cardBody: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
  });
}
