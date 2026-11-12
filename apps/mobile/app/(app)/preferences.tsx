import { useEffect, useRef, useState } from "react";
import { AppState, Linking, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useBlockedUserIds,
  useAiConsent,
  useChapterChatBackground,
  useChapterChatLevel,
  useCurrentChapter,
  useDeleteAccount,
  useGeofences,
  usePermissionList,
  useSetChapterChatLevel,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_CONSENT_COPY,
  can,
  canAll,
  CHAPTER_PROFILE_PERMISSIONS,
  CHAT_BACKGROUND_LABELS,
  chatChapterLevelLabel,
  isModuleEnabled,
  shownNotificationCategories,
} from "@repo/validation";
import { BLOCKED_MEMBERS_TITLE } from "@repo/chat-core/block-copy";
import { chatDensityLabel } from "@repo/chat-core/density";
import { AiConsentSheet } from "@/components/ai/ai-consent-sheet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_MORE } from "@/components/back-row";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { AccentSheet } from "@/components/settings/accent-sheet";
import { ChatBackgroundSheet } from "@/components/settings/chat-background-sheet";
import { BlockedMembersSheet } from "@/components/settings/blocked-members-sheet";
import { ChatDensitySheet } from "@/components/settings/chat-density-sheet";
import { ChatLevelSheet } from "@/components/settings/chat-level-sheet";
import { QuietHoursSection } from "@/components/settings/quiet-hours-section";
import { Toggle } from "@/components/toggle";
import { confirmDeleteAccount } from "@/lib/account/delete-account-prompt";
import { useAuthSession } from "@/lib/auth-session";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useChatDensity } from "@/lib/chat/chat-density";
import { shouldShowDonationCta } from "@/lib/more/donation";
import { LEGAL_LINKS } from "@/lib/more/legal";
import { acceptPrimer } from "@/lib/notifications/primer";
import {
  PUSH_PROMPT_ANSWERED_EVENT,
  pushPromptAnsweredProperties,
} from "@/lib/notifications/push-analytics";
import { pushUnavailableReason } from "@/lib/notifications/push";
import {
  pushIsOn,
  pushTapAsks,
  readPushState,
  type PushState,
} from "@/lib/notifications/push-state";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useLatestTrack } from "@/lib/use-latest-track";
import { useWhatsNewQuiet } from "@/lib/whats-new";
import {
  deviceTimeZone,
  useNotificationPreferencesSync,
} from "@/lib/use-notification-preferences-sync";

/**
 * s16 — Settings (`canvas-screens.dc.html:527`). The route file keeps the name
 * `preferences.tsx`; the drawn title is "Settings" (`spec/ui/mobile/screens.md`).
 *
 * Four sections: NOTIFICATIONS, CHAT, CHAPTER · ADMIN, ACCOUNT. All but CHAT
 * are drawn.
 *
 * ## Deviations from the drawing, each deliberate
 *
 * - **Quiet hours is here and is not drawn.** `spec/ui/README.md` gives visuals
 *   to the reference and *logic* to `spec/behavior/*`, and quiet hours is
 *   server-enforced logic with a shipped, tested client. Deleting working
 *   functionality because a mock omitted it would be a regression, so it lives
 *   under the drawn NOTIFICATIONS heading rather than in a section of its own.
 *   It is a grouped list like the rows around it: one switch while off, and
 *   time rows with native pickers only while on (`QuietHoursSection` says why).
 * - **CHAT is here and is not drawn.** It holds one row, Chat density, which
 *   opens a sheet of the three densities (`components.md` §11 § Density, owner
 *   request 2026-11-06, #2252). A section of its own because it is a display
 *   preference for this phone, not a notification or an account setting.
 * - **No Chat switch.** Chat is tuned per channel and per DM, from the
 *   conversation itself, so a switch that silenced every message at once was
 *   dropped (owner's iOS testing, 2026-11-06). Why in full: the catalog's
 *   docblock in `@repo/validation`.
 * - **No "Join code" row.** Canvas draws `Join code · TN7-4KQ` under CHAPTER ·
 *   ADMIN. There is no `join_code` anywhere on chapters; joining runs through
 *   invites, whose rows carry an opaque, single-use, role-scoped, expiring
 *   token (`apps/api/src/domain/entities/invite.entity.ts`). Rendering one of
 *   those as a stable "join code" would tell members something false about how
 *   it behaves. Filed instead.
 * - **`announcements` is not a switch.** The category has no non-URGENT
 *   traffic to govern: its one emitter, the chat push worker, sends every
 *   announcement push URGENT, and URGENT skips the category preference (#1041),
 *   so the switch would suppress nothing, a dead control. It ships once routine
 *   announcements can be told apart from emergency ones (#1323). Why in full:
 *   the catalog's docblock in `@repo/validation` and
 *   `spec/behavior/notifications.md` § Preference sync.
 * - **Appearance is static text.** The app is dark-only by design
 *   (`lib/theme.tsx`), and Canvas draws this row as a value, not a control.
 * - **"Push notifications" is a switch that reports the device's settings.**
 *   Canvas draws a toggle, and it shows what is true: on only when the OS will
 *   show a push (`pushIsOn()`). A tap asks the OS while a prompt can still help
 *   (the tap is the member accepting, so `patterns.md`'s "OS prompt only after
 *   the member accepts" holds) and otherwise opens the OS settings: an app
 *   cannot revoke its own permission, and iOS never re-prompts once asked.
 *   Before this the row always sent the member to the OS settings, even when
 *   the OS had never asked (More → Settings → Notifications → device
 *   settings, the owner's 2026-11-04 complaint). Unlike the drawing, a line
 *   under it says so whenever a tap opens the OS settings (`pushRowCaption()`).
 *   In a build that can't push it stays a status row that states why
 *   (`pushUnavailableReason()`).
 * - **Study zones says where zones are changed**, which the drawing doesn't:
 *   the row is read-only on the phone, and nothing else on it says where to go.
 * - **"Blocked members" is here and is not drawn.** `spec/behavior/chat/README.md`
 *   § Block makes a Settings list the one durable place a block is undone
 *   (#2257), and App Store Guideline 1.2 is why the control exists at all. It
 *   sits under ACCOUNT as a row that opens a sheet, the least new chrome that
 *   meets the rule.
 * - **"Mandatory events only" is still not built.** It has no backing field on
 *   `events` and no preference key. The per-category switches below are what the
 *   API actually enforces. They are drawn as the drawing draws its switches,
 *   a label and nothing under it, so the shared catalog's one-line hint per
 *   category is web's alone (why: the comment where they are mapped below).
 */

/**
 * What a tap does when it isn't the switch flipping: on, and off once no
 * prompt can help, it opens the phone's settings to turn push off or on.
 * `null` while a tap asks the OS, which the switch moving already shows.
 */
function pushSettingsAction(push: PushState): "Turn off" | "Turn on" | null {
  if (pushIsOn(push)) return "Turn off";
  return pushTapAsks(push) ? null : "Turn on";
}

/**
 * The push row's one line, drawn whenever a tap leaves the app for the OS
 * settings. Nothing else on screen says so: the row is a plain switch, so a
 * member who taps it to turn push off would otherwise see it snap back and
 * the Settings app open with no reason given.
 */
function pushRowCaption(push: PushState): string | null {
  const action = pushSettingsAction(push);
  return action ? `${action} in your phone's settings.` : null;
}

/** The push switch's accessible name: the label, then the same hand-off. */
function pushToggleLabel(push: PushState): string {
  const action = pushSettingsAction(push);
  return action
    ? `Push notifications, ${action.toLowerCase()} in your phone's settings`
    : "Push notifications";
}

export default function PreferencesScreen() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const whatsNewQuiet = useWhatsNewQuiet();
  const { signOut } = useAuthSession();
  const [linkFailed, setLinkFailed] = useState<string | null>(null);
  const deleteAccount = useDeleteAccount();

  /**
   * OS notification permission and the Android channel (`readPushState()`),
   * read once on mount and again on every foreground.
   *
   * The re-read matters because turning push *off* (and back on, once the OS
   * stops asking) happens in the OS settings app, so the member leaves,
   * changes it, and comes back — and a row still reporting the old answer
   * would be worse than no row. `null` while unread, so the switch never
   * flashes off at a member who has granted it.
   */
  const [pushState, setPushState] = useState<PushState | null>(null);
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void readPushState()
        .then((next) => {
          if (!cancelled) setPushState(next);
        })
        .catch(() => {
          // An unreadable permission is unknown, not "off" — the row draws no
          // switch rather than telling someone who has granted push to go turn
          // it on. Swallowed rather than surfaced: there is nothing a member
          // can do about it, and an unhandled rejection would be worse.
          if (!cancelled) setPushState(null);
        });
    };
    read();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") read();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  // Settings is the durable place a block is undone (#2257). The count is
  // only stated off a confirmed read: "None" from a failed one would claim
  // nobody is blocked.
  const blockedMembersSheetRef = useRef<BottomSheetModal>(null);
  const aiConsentSheetRef = useRef<BottomSheetModal>(null);
  const aiConsent = useAiConsent();
  const accentSheetRef = useRef<BottomSheetModal>(null);
  const chatDensitySheetRef = useRef<BottomSheetModal>(null);
  const chatBackgroundSheetRef = useRef<BottomSheetModal>(null);
  const chatDensity = useChatDensity();
  // The chapter-wide chat level (#3840). Unknown until read, so the row
  // states no level rather than claiming "All messages" before it knows.
  const chatLevelSheetRef = useRef<BottomSheetModal>(null);
  const chatLevel = useChapterChatLevel();
  const setChatLevel = useSetChapterChatLevel();
  const blockList = useBlockedUserIds();
  const blockedMembersValue =
    blockList.status !== "ready"
      ? "—"
      : blockList.ids.size === 0
        ? "None"
        : String(blockList.ids.size);

  const pushReason = pushUnavailableReason();
  // Read after the OS prompt closes (`useLatestTrack`).
  const track = useLatestTrack();
  // One tap at a time: a second tap while the OS prompt is up would queue a
  // second prompt, or open the settings app over it.
  const pushTapInFlight = useRef(false);

  /**
   * The push switch's one action, for every state. It re-reads the permission
   * first rather than trusting the last read, because the answer can change
   * outside the app (the OS settings, or a prompt answered elsewhere).
   *
   * - Not granted, and the OS will still ask (`pushTapAsks()`): ask. The
   *   member tapping this row is them accepting, which is the step
   *   `patterns.md` § Push notifications puts before the OS prompt, so it goes
   *   through the primer's own accept (`acceptPrimer()`): the decision is
   *   recorded first, so onboarding's step and the chat home's reminder
   *   aren't offered afterwards with a
   *   "Turn on" the OS would now ignore.
   * - On: the OS settings, since an app cannot revoke its own permission.
   * - Off, and no prompt can help: the OS settings, the only place left. That
   *   is iOS after one answer, Android after a second "Don't allow",
   *   Android 13+ with the permission granted but the app's notifications
   *   blocked, and Android with the app's channel switched off.
   */
  async function handlePushTap() {
    if (pushTapInFlight.current) return;
    pushTapInFlight.current = true;
    try {
      const current = await readPushState().catch(() => null);
      if (current && pushTapAsks(current)) {
        // A prompt the OS failed to show reads as not granted; the re-read
        // below reports whatever is true either way.
        const granted = await acceptPrimer();
        track(
          PUSH_PROMPT_ANSWERED_EVENT,
          pushPromptAnsweredProperties(
            granted ? "allowed" : "denied",
            "settings",
          ),
        );
        setPushState(await readPushState().catch(() => null));
        return;
      }
      if (current) setPushState(current);
      await Linking.openSettings().catch(() => undefined);
    } finally {
      pushTapInFlight.current = false;
    }
  }

  const {
    quietHoursEnabled,
    setQuietHoursEnabled,
    categories,
    setCategory,
    quietHoursWindow,
    setQuietHoursWindow,
    isHydrated,
    hydrationRecovered,
    persistenceFailed,
    isAuthenticated,
    chapterId,
    quietHoursSync,
    categorySync,
    storedZoneMissing,
  } = useNotificationPreferencesSync();

  // `can`, never a bare `includes` — an owner's grant is the wildcard `*`, so a
  // membership test would lock out exactly the people this section is for.
  const permissions = usePermissionList();
  const canSeeChapterAdmin = can("chapter-config:view", permissions);
  // The guard on `PATCH /v1/chapters/current`, which the accent save calls.
  const canEditAccent = canAll(CHAPTER_PROFILE_PERMISSIONS, permissions);
  const chapterBackground = useChapterChatBackground();

  const chapterQuery = useCurrentChapter();
  const enabledModules = chapterQuery.data?.enabled_modules;
  const donationUrl = chapterQuery.data?.donation_url;
  const showDonationCta = shouldShowDonationCta(permissions, donationUrl);
  const geofencesEnabled =
    canSeeChapterAdmin && isModuleEnabled(enabledModules, "geofences");
  // Gated, not just hidden: the route requires `members:view` **and** the
  // `geofences` module, so firing it for a member who will not see the row
  // spends a request to collect a 403.
  //
  // `GET /v1/geofences` has no response schema, so the SDK types the body
  // `never` — narrowed through `unknown` the way every other read in this
  // cluster is (`lib/more/narrow.ts`).
  const geofencesQuery = useGeofences({ enabled: geofencesEnabled });
  const zones = geofencesQuery.data as unknown;
  const zoneCount = Array.isArray(zones) ? zones.length : null;

  // `null` when there is nothing to report. "Synced with your account." was
  // shown in the steady state, which is the one state that needs no line.
  const notificationsMeta = !isHydrated
    ? "Loading your saved preferences…"
    : hydrationRecovered
      ? "Saved preferences were unreadable and have been reset to defaults."
      : !isAuthenticated
        ? "Saved on this device only. Sign in to change the settings on your account."
        : !chapterId
          ? "Category switches sync once you choose a chapter."
          : categorySync === "retry" || quietHoursSync === "retry"
            ? "Couldn't reach the server. Change a setting again to retry."
            : categorySync === "pending" || quietHoursSync === "pending"
              ? "Saving…"
              : categorySync === "loading" || quietHoursSync === "loading"
                ? "Loading your preferences…"
                : null;

  async function handleSignOut() {
    await signOut();
    // `signOut` drops the query cache itself (`lib/auth-session.tsx`), so every
    // sign-out path gets it without each screen remembering to.
    router.replace("/(auth)/sign-in");
  }

  /**
   * Shared by every external-link row below (donation + legal). Clearing
   * `linkFailed` up front, not just setting it on rejection, matters because
   * the footnote is a single shared slot: without the clear, a failed donation
   * open followed by a successful Terms tap would leave "Support the Chapter
   * couldn't be opened" showing indefinitely.
   */
  function openExternalLink(label: string, url: string) {
    setLinkFailed(null);
    // A rejection here is real — iOS rejects a second presentation while one
    // is already showing — so it is surfaced rather than left as an
    // unhandled promise.
    WebBrowser.openBrowserAsync(url).catch(() => setLinkFailed(label));
  }

  function handleDeleteAccount() {
    confirmDeleteAccount({
      deleteAccount,
      onDeleted: () => {
        void handleSignOut();
      },
    });
  }

  return (
    <ScreenShell back={BACK_TO_MORE} title="Settings">
      <SectionHeader>Notifications</SectionHeader>

      <ListSection>
        {pushReason ? (
          // A build that can't push: nothing here or in the OS settings can
          // change that, so the row states why and does nothing on a tap.
          <ListRow
            label="Push notifications"
            value="Unavailable"
            description={pushReason}
          />
        ) : pushState ? (
          <ListRow
            label="Push notifications"
            description={pushRowCaption(pushState)}
            trailing={
              <Toggle
                value={pushIsOn(pushState)}
                onValueChange={() => void handlePushTap()}
                accessibilityLabel={pushToggleLabel(pushState)}
              />
            }
          />
        ) : (
          // Unread, or the read failed. No switch: drawing it off would tell
          // a member who has granted push that they haven't. A tap still
          // re-reads and acts on the answer.
          <ListRow
            label="Push notifications"
            value="—"
            accessibilityHint="Turns notifications on, or opens your phone's settings for them."
            onPress={() => void handlePushTap()}
          />
        )}
      </ListSection>

      <QuietHoursSection
        enabled={quietHoursEnabled}
        onEnabledChange={setQuietHoursEnabled}
        quietHoursWindow={quietHoursWindow}
        onWindowChange={setQuietHoursWindow}
        deviceTimeZone={deviceTimeZone()}
        storedZoneMissing={storedZoneMissing}
        windowEditable={quietHoursSync !== "loading"}
      />

      <ListSection>
        <ListRow
          label="Chat messages"
          value={chatLevel.data ? chatChapterLevelLabel(chatLevel.data) : "—"}
          accessibilityHint="Choose whether every message or only mentions and DMs notify you."
          disabled={!chatLevel.data}
          busy={setChatLevel.isPending}
          onPress={() => chatLevelSheetRef.current?.present()}
        />
        {shownNotificationCategories(permissions).map((category) => (
          // No description. The shared catalog carries one per category for
          // web's Profile card, but on the phone five two-line hints pushed
          // Account three screens down, and the labels say enough.
          <ListRow
            key={category.key}
            label={category.label}
            trailing={
              <Toggle
                value={categories[category.key]}
                onValueChange={(value) => setCategory(category.key, value)}
                accessibilityLabel={category.label}
              />
            }
          />
        ))}
      </ListSection>

      {/* Scoped to this grid, never a delivery promise: a member's channel
          level for #announcements, or a block, still stops an announcement
          push (`spec/behavior/chat/README.md`). Why there is no switch: the
          docblock's `announcements` bullet. */}
      {setChatLevel.isError ? (
        <Text style={styles.footnoteError}>
          Couldn&apos;t change chat messages. Try again.
        </Text>
      ) : null}
      <Text style={styles.footnote}>
        Mute a channel or DM from the chat itself. Chapter announcements
        can&apos;t be switched off here.
      </Text>
      {notificationsMeta ? (
        <Text style={styles.footnote}>{notificationsMeta}</Text>
      ) : null}
      {persistenceFailed ? (
        <Text style={styles.footnoteError}>
          This device couldn&apos;t save a local copy, so these may not show
          while you&apos;re offline. Your account is unaffected.
        </Text>
      ) : null}

      <SectionHeader>Chat</SectionHeader>
      <ListSection>
        {/* One row, a tap from the picker: the sheet draws every density so
            the choice is made by looking (components.md §11 § Density). */}
        <ListRow
          label="Chat density"
          value={chatDensityLabel(chatDensity)}
          accessibilityHint="Choose how tightly messages are drawn in chat."
          onPress={() => chatDensitySheetRef.current?.present()}
        />
      </ListSection>

      {canSeeChapterAdmin ? (
        <>
          <SectionHeader>Chapter · Admin</SectionHeader>
          <ListSection>
            <ListRow
              label="Chapter accent"
              // An editor's row is the swatch and a chevron. Anyone else's
              // can't open, so it says who can change it rather than leaving a
              // dead row unexplained (design-system README §5).
              description={
                canEditAccent
                  ? null
                  : "Set by an officer with chapter settings access."
              }
              accessibilityHint={
                canEditAccent
                  ? "Opens the color picker for the chapter accent."
                  : undefined
              }
              onPress={
                canEditAccent
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
              // The same guard as the accent: the default's route requires
              // `CHAPTER_PROFILE_PERMISSIONS` (#4031).
              value={
                chapterBackground.data
                  ? CHAT_BACKGROUND_LABELS[chapterBackground.data.background]
                  : undefined
              }
              description={
                canEditAccent
                  ? null
                  : "Set by an officer with chapter settings access."
              }
              accessibilityHint={
                canEditAccent
                  ? "Choose the background every channel shows unless it has its own."
                  : undefined
              }
              onPress={
                canEditAccent
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

      <SectionHeader>Account</SectionHeader>
      <ListSection>
        {/* Static, not a control: Signet is dark-only by design (lib/theme.tsx),
            and Canvas draws this row as a value too. */}
        <ListRow label="Appearance" value="Dark" />
        {/* Only where the server has AI (`AI_ENABLED`): with it off this
            row, like every AI entry, isn't drawn. Opens the same sheet the
            first AI action does, to change the answer any time. */}
        {aiConsent.data ? (
          <ListRow
            label={AI_CONSENT_COPY.settingsSwitch}
            value={
              aiConsent.data.sheet_changed || !aiConsent.data.answer
                ? "Not answered"
                : aiConsent.data.answer === "yes"
                  ? "Yes"
                  : "No"
            }
            accessibilityHint="Shows what AI features use, and lets you change your answer."
            onPress={() => aiConsentSheetRef.current?.present()}
          />
        ) : null}
        <ListRow
          label="What's new"
          accessibilityHint="Shows the latest changes to the app."
          // Another device showed the newest entry first (#4043). Neutral, as
          // every unread mark is (components.md § Chrome weight), and the
          // same dot web's account menu draws.
          trailing={
            whatsNewQuiet ? <View style={styles.unreadDot} /> : undefined
          }
          accessibilityValue={whatsNewQuiet ? "New" : undefined}
          onPress={() => router.push("/whats-new")}
        />
        <ListRow
          label={BLOCKED_MEMBERS_TITLE}
          value={blockedMembersValue}
          accessibilityHint="Shows the members you've blocked in chat, and lets you unblock them."
          onPress={() => blockedMembersSheetRef.current?.present()}
        />
        {showDonationCta ? (
          <ListRow
            label="Support the Chapter"
            accessibilityHint="Opens the chapter's donation page in your browser."
            onPress={() => openExternalLink("Support the Chapter", donationUrl)}
          />
        ) : null}
        {LEGAL_LINKS.map((link) => (
          <ListRow
            key={link.url}
            label={link.label}
            accessibilityHint="Opens in your browser."
            onPress={() => openExternalLink(link.label, link.url)}
          />
        ))}
        <ListRow
          label="Sign out"
          action
          destructive
          onPress={() => {
            void handleSignOut();
          }}
        />
        <ListRow
          label={
            deleteAccount.isPending ? "Deleting account…" : "Delete account"
          }
          action
          destructive
          disabled={deleteAccount.isPending}
          accessibilityHint="Permanently deletes your account. You'll be asked to confirm."
          onPress={handleDeleteAccount}
        />
      </ListSection>
      {linkFailed ? (
        <Text style={styles.footnoteError}>
          {linkFailed} couldn&apos;t be opened. Try again in a moment.
        </Text>
      ) : null}
      <BlockedMembersSheet ref={blockedMembersSheetRef} />
      {aiConsent.data ? (
        <AiConsentSheet ref={aiConsentSheetRef} consent={aiConsent.data} />
      ) : null}
      <AccentSheet ref={accentSheetRef} />
      <ChatDensitySheet ref={chatDensitySheetRef} />
      <ChatBackgroundSheet ref={chatBackgroundSheetRef} />
      <ChatLevelSheet
        ref={chatLevelSheetRef}
        level={chatLevel.data}
        onPick={(level) => setChatLevel.mutate(level)}
      />
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
    footnoteError: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      paddingHorizontal: tokens.spacing.xs,
    },
    unreadDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: tokens.color.text.foreground,
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
