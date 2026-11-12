import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useChapterChatBackground,
  useCurrentChapter,
  useGeofences,
  usePermissionList,
  useRoles,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  canAll,
  CHAPTER_PROFILE_PERMISSIONS,
  CHAT_BACKGROUND_LABELS,
  isModuleEnabled,
} from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_MORE } from "@/components/back-row";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { AccentSheet } from "@/components/settings/accent-sheet";
import { ChatBackgroundSheet } from "@/components/settings/chat-background-sheet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { chapterSettingsAccess } from "@/lib/more/chapter-settings";
import { useFrappTheme } from "@/lib/theme";

/**
 * Chapter settings, on the phone (#4074): the chapter's side of settings, as
 * web's Chapter settings is, reached from More → Admin. Settings (s16) is the
 * member's own; until this screen it also carried a "Chapter · Admin" group,
 * which moved here whole.
 *
 * - **Chapter**: the accent and the chat background, each a sheet for a
 *   member holding `CHAPTER_PROFILE_PERMISSIONS` and read-only, saying who
 *   sets it, for anyone else; and Study zones, read-only, since zones are
 *   drawn on the web dashboard.
 * - **People**: Roles, the chapter's tiers and their roles
 *   (`app/(app)/chapter-roles.tsx`).
 *
 * Web's other pages (Plan and billing, the module pages, vocabulary, member
 * fields) stay on web for now: they are setup an officer does once, at a desk.
 * Grouped rows with a chevron, as iOS Settings and Discord mobile's Server
 * Settings draw theirs.
 */
export default function ChapterSettingsScreen() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const accentSheetRef = useRef<BottomSheetModal>(null);
  const chatBackgroundSheetRef = useRef<BottomSheetModal>(null);

  const permissions = usePermissionList();
  const access = chapterSettingsAccess(permissions);
  // The guard on `PATCH /v1/chapters/current`, which the accent save calls,
  // and on the chat background default (#4031).
  const canEditProfile = canAll(CHAPTER_PROFILE_PERMISSIONS, permissions);
  const chapterBackground = useChapterChatBackground();

  const chapterQuery = useCurrentChapter();
  const geofencesEnabled =
    access.chapter &&
    isModuleEnabled(chapterQuery.data?.enabled_modules, "geofences");
  // Gated, not just hidden: the route requires `members:view` and the
  // `geofences` module, so firing it for a member who won't see the row
  // spends a request to collect a 403. No response schema, so narrowed
  // through `unknown`.
  const geofencesQuery = useGeofences({ enabled: geofencesEnabled });
  const zones = geofencesQuery.data as unknown;
  const zoneCount = Array.isArray(zones) ? zones.length : null;

  // Every member may read the roles (`members:view`); this shares the Roles
  // screen's cache entry, so opening this warms that.
  // `GET /v1/roles` declares no response schema, so read through `unknown`.
  const roles = useRoles().data as unknown;
  const roleCount = Array.isArray(roles) ? roles.length : null;

  const readOnlyLine = canEditProfile
    ? null
    : "Set by an officer with chapter settings access.";

  return (
    <ScreenShell back={BACK_TO_MORE} title="Chapter settings">
      {access.chapter ? (
        <>
          <SectionHeader>Chapter</SectionHeader>
          <ListSection>
            <ListRow
              label="Chapter accent"
              // An editor's row is the swatch and a chevron. Anyone else's
              // can't open, so it says who can change it rather than leaving
              // a dead row unexplained (design-system README §5).
              description={readOnlyLine}
              accessibilityHint={
                canEditProfile
                  ? "Opens the color picker for the chapter accent."
                  : undefined
              }
              onPress={
                canEditProfile
                  ? () => accentSheetRef.current?.present()
                  : undefined
              }
              trailing={
                <View
                  accessibilityLabel="Current chapter accent"
                  style={[styles.swatch, { backgroundColor: accent }]}
                />
              }
            />
            <ListRow
              label="Chat background"
              value={
                chapterBackground.data
                  ? CHAT_BACKGROUND_LABELS[chapterBackground.data.background]
                  : undefined
              }
              description={readOnlyLine}
              accessibilityHint={
                canEditProfile
                  ? "Choose the background every channel shows unless it has its own."
                  : undefined
              }
              onPress={
                canEditProfile
                  ? () => chatBackgroundSheetRef.current?.present()
                  : undefined
              }
            />
            {geofencesEnabled ? (
              // Read-only here (the phone has no zone editor), so it says
              // where zones are changed: the dashboard's Study zones tool.
              <ListRow
                label="Study zones"
                description="Managed on the web dashboard."
                value={
                  zoneCount === null
                    ? "—"
                    : `${zoneCount} ${zoneCount === 1 ? "zone" : "zones"}`
                }
              />
            ) : null}
          </ListSection>
        </>
      ) : null}

      {access.roles ? (
        <>
          <SectionHeader>People</SectionHeader>
          <ListSection>
            <ListRow
              label="Roles"
              value={roleCount === null ? null : String(roleCount)}
              accessibilityHint="Opens the chapter's tiers and roles, and what each can do."
              onPress={() => router.push("/chapter-roles")}
            />
          </ListSection>
        </>
      ) : null}

      {access.chapter ? (
        <>
          <AccentSheet ref={accentSheetRef} />
          <ChatBackgroundSheet ref={chatBackgroundSheetRef} />
        </>
      ) : null}
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    swatch: {
      width: tokens.spacing.xl,
      height: tokens.spacing.xl,
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
    },
  });
}
