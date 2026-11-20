import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useActiveChapterId,
  useCurrentUser,
  useEvents,
  usePickableRoles,
} from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import {
  WELCOME_CARD_COPY,
  welcomeCardEventWhen,
  welcomeCardEvents,
  welcomeCardTitle,
} from "@repo/validation";
import { CloseGlyph, ForwardGlyph } from "@/components/control-glyphs";
import { ProfilePhoto } from "@/components/profile/profile-photo";
import { PickRolesList } from "@/components/roles/pick-roles-list";
import { ChatDensityOptions } from "@/components/settings/chat-density-sheet";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { initialsFor } from "@/lib/more/narrow";
import { selectViewerProfile } from "@/lib/more/profile";
import { clearWelcomeDue, isWelcomeDue } from "@/lib/onboarding/welcome-due";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";
import { typeRole, useFrappTheme } from "@/lib/theme";

type EventRow = {
  id: string;
  name: string;
  start_time: string;
  end_time?: string | null;
};

/**
 * The welcome card (#5627; Paul's pick 2026-11-19, "welcome card, no tour"):
 * once, under the header of the first channel a new member opens after s03,
 * which is the chapter's default channel (chat home opens it on arrival,
 * `landingChannelId`). It replaced the first-run tour. Web draws the same
 * card (`apps/web/components/onboarding/welcome-card.tsx`).
 *
 * "Welcome to <chapter>, <first name>", the chapter's next two events with
 * their days written out (each opens the event), and **Finish your profile**,
 * a sheet with the photo, the roles they can join and the chat display: what
 * s03 stopped asking up front. Closing it is for good, on this phone
 * (`lib/onboarding/welcome-due.ts`).
 */
export function WelcomeCard() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const chapterId = useActiveChapterId();
  const { chapterName } = useChapterBranding();
  const userQuery = useCurrentUser();
  const profile = useMemo(
    () => selectViewerProfile(userQuery.data),
    [userQuery.data],
  );
  const userId = (userQuery.data as { id?: string } | undefined)?.id ?? null;
  const [due, setDue] = useState(false);
  const sheet = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void isWelcomeDue(userId, chapterId).then((value) => {
      if (live) setDue(value);
    });
    return () => {
      live = false;
    };
  }, [userId, chapterId]);

  const events = useEvents({ enabled: due });
  const upcoming = useMemo(
    () =>
      welcomeCardEvents(
        (Array.isArray(events.data) ? events.data : []) as EventRow[],
        new Date(),
      ),
    [events.data],
  );

  // Drawn once the events have answered, so the rows never push it taller.
  if (!due || events.isPending) return null;

  const close = () => {
    setDue(false);
    void clearWelcomeDue();
  };

  return (
    <View testID="welcome-card" style={styles.card}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.title}>
          {welcomeCardTitle(chapterName, profile?.displayName)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={WELCOME_CARD_COPY.close}
          onPress={close}
          hitSlop={8}
          style={({ pressed }) => [
            styles.close,
            pressed ? styles.pressed : null,
          ]}
        >
          <CloseGlyph size={16} color={tokens.color.text.mutedForeground} />
        </Pressable>
      </View>
      {upcoming.map((event) => (
        <Pressable
          key={event.id}
          accessibilityRole="button"
          accessibilityLabel={`${event.name}, ${welcomeCardEventWhen(event.start_time, new Date())}`}
          onPress={() =>
            router.push({
              pathname: "/event-details",
              params: { id: event.id },
            })
          }
          style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
        >
          <Text numberOfLines={1} style={styles.rowName}>
            {event.name}
          </Text>
          <Text style={styles.rowWhen}>
            {welcomeCardEventWhen(event.start_time, new Date())}
          </Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={WELCOME_CARD_COPY.finishProfile}
        accessibilityHint={WELCOME_CARD_COPY.finishProfileHint}
        onPress={() => sheet.current?.present()}
        style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      >
        <Text numberOfLines={1} style={[styles.rowName, styles.finish]}>
          {WELCOME_CARD_COPY.finishProfile}
        </Text>
        <Text style={styles.rowWhen}>
          {WELCOME_CARD_COPY.finishProfileHint}
        </Text>
        <ForwardGlyph color={tokens.color.text.mutedForeground} />
      </Pressable>
      <FinishProfileSheet
        ref={sheet}
        photoUrl={profile?.photoUrl ?? null}
        fetchedAt={userQuery.dataUpdatedAt}
        initials={initialsFor(profile?.displayName ?? null)}
      />
    </View>
  );
}

/**
 * Finish your profile: the three things s03 no longer asks, each the control
 * its own place uses (Profile's photo, the Directory's Add roles, Settings'
 * Chat density), so a change here is the same change there.
 */
const FinishProfileSheet = forwardRef<
  BottomSheetModal,
  { photoUrl: string | null; fetchedAt: number; initials: string }
>(function FinishProfileSheet({ photoUrl, fetchedAt, initials }, ref) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();
  const closeSheet = useSheetClose(ref);
  const { roles } = usePickableRoles();
  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tallSheet}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.sheetContent}
      >
        <TallSheetHeader
          title={WELCOME_CARD_COPY.sheetTitle}
          onClose={closeSheet}
        />
        <Text style={styles.lede}>{WELCOME_CARD_COPY.sheetLede}</Text>
        <Text accessibilityRole="header" style={styles.section}>
          {WELCOME_CARD_COPY.photo}
        </Text>
        <View style={styles.photo}>
          <ProfilePhoto
            photoUrl={photoUrl}
            fetchedAt={fetchedAt}
            initials={initials}
          />
        </View>
        {roles.length > 0 ? (
          <>
            <Text accessibilityRole="header" style={styles.section}>
              {WELCOME_CARD_COPY.roles}
            </Text>
            <PickRolesList roles={roles} />
          </>
        ) : null}
        <Text accessibilityRole="header" style={styles.section}>
          {WELCOME_CARD_COPY.display}
        </Text>
        <ChatDensityOptions />
        <View style={styles.footer} />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      marginHorizontal: tokens.spacing.lg,
      marginTop: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xs,
      borderRadius: tokens.radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.sm,
      marginBottom: tokens.spacing.xs,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      fontSize: tokens.typography.role.body.size,
      color: tokens.color.text.foreground,
      flex: 1,
    },
    close: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
      marginTop: -4,
      marginRight: -6,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    rowName: {
      ...typeRole(tokens.typography.role.body),
      fontSize: tokens.typography.role.label.size,
      color: tokens.color.text.foreground,
      flex: 1,
    },
    finish: {
      fontWeight: "600",
    },
    rowWhen: {
      ...typeRole(tokens.typography.role.body),
      fontSize: tokens.typography.role.label.size,
      color: tokens.color.text.mutedForeground,
    },
    pressed: { opacity: 0.6 },
    sheetContent: {
      paddingHorizontal: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    lede: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    section: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      marginTop: tokens.spacing.sm,
    },
    photo: { alignItems: "flex-start" },
    footer: { height: tokens.spacing.xl },
  });
}
