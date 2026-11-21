import { useRef, useState } from "react";
import { StyleSheet, Text, View, type ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useAiChapterSettings,
  useAiConsent,
  useChapterChatBackground,
  useCurrentChapter,
  useGeofences,
  usePermissionList,
  useUpdateAiChapterSettings,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_SETTINGS_COPY,
  AI_SWITCHES,
  aiSwitchState,
  canAll,
  type AiChapterSwitchKey,
  CHAPTER_LOGS_TITLE,
  CHAPTER_PROFILE_PERMISSIONS,
  CHAT_BACKGROUND_LABELS,
  isModuleEnabled,
} from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_CHAT } from "@/components/back-row";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { AccentSheet } from "@/components/settings/accent-sheet";
import { ChatBackgroundSheet } from "@/components/settings/chat-background-sheet";
import {
  SettingAnchor,
  SettingJumpProvider,
  useSettingJumpState,
} from "@/components/settings/setting-anchor";
import { useSettingsSearchField } from "@/components/settings/settings-search";
import { Toggle } from "@/components/toggle";
import { useChapterBranding } from "@/lib/chapter-branding";
import { chapterSettingsAccess } from "@/lib/more/chapter-settings";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Chapter settings, on the phone (#4074): the chapter's side of settings, as
 * web's Chapter settings is, reached from the chapter menu on Chat home's
 * chapter name (2026-11-19; You → Admin until then). Settings (s16) is the
 * member's own; until this screen it also carried a "Chapter · Admin" group,
 * which moved here whole.
 *
 * - **Chapter**: the accent and the chat background, each a sheet for a
 *   member holding `CHAPTER_PROFILE_PERMISSIONS` and read-only, saying who
 *   sets it, for anyone else; and Study zones, read-only, since zones are
 *   drawn on the web dashboard.
 * - **AI**: the president's three switches (#4789), the same ones and the
 *   same rules as web's AI tab (`settings-ai-tab.tsx`): every member here can
 *   read them, only the president changes them, and Include channel messages
 *   sits nested under Ask Frapp and waits for it to be on before it can be
 *   turned on (never off), by `aiSwitchState`, which web's tab shares. For
 *   `chapter-config:view`, as web's tab is.
 *   Inline switches, as iOS Settings draws a short list of them, rather than
 *   a page of their own. Drawn only where the server has AI.
 * - **People**: Roles and groups, the chapter's tiers and their roles, then
 *   its groups (`app/(app)/chapter-roles.tsx`).
 *
 * Web's other pages (Plan and billing, the module pages, vocabulary, member
 * fields) stay on web for now: they are setup an officer does once, at a desk.
 * Grouped rows with a chevron, as iOS Settings and Discord mobile's Server
 * Settings draw theirs.
 *
 * **Search settings** (2026-11-19) sits on top, as on web and in iOS
 * Settings: it finds every setting the member can change, here or on
 * Settings, and web-only ones open the dashboard
 * (`components/settings/settings-search.tsx`). A `setting` param, from that
 * search or from Search, lights its row (`SettingAnchor`).
 */
export default function ChapterSettingsScreen() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const accentSheetRef = useRef<BottomSheetModal>(null);
  const chatBackgroundSheetRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<ScrollView>(null);
  const { setting } = useLocalSearchParams<{ setting?: string }>();
  const jump = useSettingJumpState(setting);
  const search = useSettingsSearchField({
    here: "/chapter-settings",
    jumpHere: jump.jump,
  });

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

  // The consent read says whether the server has AI at all (null when it
  // doesn't), as every AI entry on the phone asks before drawing.
  // Web's AI tab is a Chapter settings page, so it opens for
  // `chapter-config:view` (`settings-access.ts`); the phone draws its
  // switches for the same people, not for a roles manager without it.
  const aiConsent = useAiConsent({ enabled: access.chapter });
  const aiAvailable = access.chapter && !!aiConsent.data;
  const aiSettingsQuery = useAiChapterSettings({ enabled: aiAvailable });
  const aiSettings = aiSettingsQuery.data;
  const updateAi = useUpdateAiChapterSettings();
  // The switch whose last save failed. The phone has no toast, so the failure
  // is that row's second line, and the switch snaps back (navigation.md §
  // Chapter settings).
  const [aiFailedKey, setAiFailedKey] = useState<AiChapterSwitchKey | null>(
    null,
  );

  const readOnlyLine = canEditProfile
    ? null
    : "Set by an officer with chapter settings access.";

  return (
    <ScreenShell
      back={BACK_TO_CHAT}
      title="Chapter settings"
      scrollRef={scrollRef}
      keyboardShouldPersistTaps="handled"
    >
      {search.field}
      {search.searching ? search.results : null}
      <SettingJumpProvider
        anchor={search.searching ? null : jump.anchor}
        serial={jump.serial}
        scrollRef={scrollRef}
      >
        {search.searching ? null : (
          <>
            {access.chapter ? (
              <>
                <SectionHeader>Chapter</SectionHeader>
                <ListSection>
                  <SettingAnchor id="accent">
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
                  </SettingAnchor>
                  <SettingAnchor id="chat-background">
                    <ListRow
                      label="Chat background"
                      value={
                        chapterBackground.data
                          ? CHAT_BACKGROUND_LABELS[
                              chapterBackground.data.background
                            ]
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
                  </SettingAnchor>
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
                  {access.logs ? (
                    // Last in Chapter, as web's Logs row is (Paul,
                    // 2026-11-21): read when something needs looking into.
                    <ListRow
                      label={CHAPTER_LOGS_TITLE}
                      accessibilityHint="Opens who changed what in the chapter, and when."
                      onPress={() => router.push("/chapter-logs")}
                    />
                  ) : null}
                </ListSection>
              </>
            ) : null}

            {aiAvailable && aiSettings ? (
              <SettingAnchor id="ai">
                <SectionHeader>{AI_SETTINGS_COPY.title}</SectionHeader>
                <ListSection>
                  {AI_SWITCHES.map((entry) => {
                    const { checked, parentOff, waitsOnParent } = aiSwitchState(
                      entry,
                      aiSettings,
                    );
                    const failed = aiFailedKey === entry.key;
                    return (
                      <ListRow
                        key={entry.key}
                        label={entry.label}
                        nested={entry.dependsOn !== undefined}
                        muted={parentOff}
                        description={
                          failed
                            ? `${AI_SETTINGS_COPY.saveFailed}. Try again.`
                            : waitsOnParent
                              ? `${entry.short} ${AI_SETTINGS_COPY.dependsOnAsk}`
                              : entry.short
                        }
                        descriptionTone={failed ? "destructive" : "default"}
                        trailing={
                          <Toggle
                            value={checked}
                            disabled={
                              !aiSettings.can_change ||
                              // One save at a time: each answer replaces the whole
                              // cached row, so two in flight could draw one wrong.
                              updateAi.isPending ||
                              // Waiting on Ask blocks turning it on, never off.
                              waitsOnParent
                            }
                            onValueChange={(next) => {
                              setAiFailedKey(null);
                              updateAi.mutate(
                                { [entry.key]: next },
                                { onError: () => setAiFailedKey(entry.key) },
                              );
                            }}
                            accessibilityLabel={entry.label}
                          />
                        }
                      />
                    );
                  })}
                </ListSection>
                <Text style={styles.footnote}>
                  {aiSettings.can_change
                    ? AI_SETTINGS_COPY.phoneFootnote
                    : `${AI_SETTINGS_COPY.presidentOnly} ${AI_SETTINGS_COPY.phoneFootnote}`}
                </Text>
              </SettingAnchor>
            ) : null}

            {access.roles ? (
              <>
                <SectionHeader>People</SectionHeader>
                <ListSection>
                  <ListRow
                    label="Roles and groups"
                    accessibilityHint="Opens the chapter's tiers, roles and groups."
                    onPress={() => router.push("/chapter-roles")}
                  />
                </ListSection>
              </>
            ) : null}
          </>
        )}
      </SettingJumpProvider>

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
    footnote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.xs,
    },
    swatch: {
      width: tokens.spacing.xl,
      height: tokens.spacing.xl,
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
    },
  });
}
