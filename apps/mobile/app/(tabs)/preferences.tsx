import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useBlockedUserIds,
  useCurrentChapter,
  useDeleteAccount,
  useGeofences,
  usePermissionList,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  can,
  canAll,
  CHAPTER_PROFILE_PERMISSIONS,
  isModuleEnabled,
  isSupportedTimeZone,
  MAX_TIME_ZONE_LENGTH,
  shownNotificationCategories,
} from "@repo/validation";
import { BLOCKED_MEMBERS_TITLE } from "@repo/chat-core/block-copy";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_MORE } from "@/components/back-row";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { AccentSheet } from "@/components/settings/accent-sheet";
import { BlockedMembersSheet } from "@/components/settings/blocked-members-sheet";
import { Toggle } from "@/components/toggle";
import { confirmDeleteAccount } from "@/lib/account/delete-account-prompt";
import { useAuthSession } from "@/lib/auth-session";
import { useChapterBranding } from "@/lib/chapter-branding";
import { shouldShowDonationCta } from "@/lib/more/donation";
import { LEGAL_LINKS } from "@/lib/more/legal";
import { acceptPrimer } from "@/lib/notifications/primer";
import {
  getPushPermission,
  isPushChannelBlocked,
  pushUnavailableReason,
} from "@/lib/notifications/push";
import type { PushPermissionStatus } from "@/lib/notifications/push-types";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  type QuietHoursWindow,
  useNotificationPreferencesSync,
} from "@/lib/use-notification-preferences-sync";

/**
 * s16 — Settings (`canvas-screens.dc.html:527`). The route file keeps the name
 * `preferences.tsx`; the drawn title is "Settings" (`spec/ui/mobile/screens.md`).
 *
 * Three sections, as drawn: NOTIFICATIONS, CHAPTER · ADMIN, ACCOUNT.
 *
 * ## Deviations from the drawing, each deliberate
 *
 * - **Quiet hours is here and is not drawn.** `spec/ui/README.md` gives visuals
 *   to the reference and *logic* to `spec/behavior/*`, and quiet hours is
 *   server-enforced logic with a shipped, tested client. Deleting working
 *   functionality because a mock omitted it would be a regression, so it lives
 *   under the drawn NOTIFICATIONS heading rather than in a section of its own.
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

const TIME_INPUT_PATTERN = /^\d{2}:\d{2}$/;

/**
 * Must agree with the hook's normalizer, including the range check — otherwise a
 * value like `24:00` passes here, is rejected there, and the edit silently no-ops
 * while the field still shows the uncommitted text.
 */
function isValidTimeInput(value: string): boolean {
  if (!TIME_INPUT_PATTERN.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours <= 23 && minutes <= 59;
}

/** "22:00" -> "10:00 PM". Falls back to the raw value for anything unparseable. */
function formatTimeOfDay(value: string): string {
  if (!isValidTimeInput(value)) return value;
  const [rawHours, rawMinutes] = value.split(":");
  const hours = Number(rawHours);
  const suffix = hours < 12 ? "AM" : "PM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${rawMinutes} ${suffix}`;
}

/**
 * What the push switch reads: the OS permission, and whether the member has
 * switched off the app's Android push channel (`isPushChannelBlocked()`),
 * which the permission doesn't report.
 */
type PushState = PushPermissionStatus & { channelBlocked: boolean };

/**
 * Both reads, together, so the switch never pairs a fresh one with a stale
 * other. `null` when there is no module to ask; rejects if either read fails,
 * which the callers treat as unknown.
 */
async function readPushState(): Promise<PushState | null> {
  const [permission, channelBlocked] = await Promise.all([
    getPushPermission(),
    isPushChannelBlocked(),
  ]);
  return permission ? { ...permission, channelBlocked } : null;
}

/**
 * Whether the OS will show a push, which is what the switch reports.
 *
 * `status`, not `granted`. On Android 13+ (`targetSdk` 33 and up)
 * expo-notifications 57 sets `granted` from the POST_NOTIFICATIONS runtime
 * permission alone, and reports the app's notifications being switched off
 * (`areNotificationsEnabled()`) only in `status`. So
 * `{ granted: true, status: "denied" }` is a real answer, and that device
 * shows nothing (`NotificationPermissionsModule.kt`,
 * `getPermissionsWithPromiseImplApi33`). Below Android 13 and on iOS the two
 * fields agree. iOS reports `status: "granted"` only for full authorization
 * (`ExpoNotificationsPermissionsRequester.swift`): a provisional or ephemeral
 * grant reads `"undetermined"`, so the switch is off there and a tap asks for
 * the full prompt.
 *
 * Nor is it on with the app's Android push channel switched off: `status`
 * still reads `"granted"` then, but that channel is where the API's pushes
 * show (`isPushChannelBlocked()`).
 */
function pushIsOn(push: PushState): boolean {
  return push.status === "granted" && !push.channelBlocked;
}

/**
 * Whether a tap should show the OS prompt: nothing granted yet, the OS will
 * still ask, and a grant would be enough. A granted permission whose
 * notifications are blocked (the Android 13+ case above) is not one: Android
 * answers that request at once, with no prompt. Nor is a channel switched
 * off, which no prompt turns back on. Only the OS settings fix those.
 */
function pushTapAsks(push: PushState): boolean {
  return !push.granted && push.canAskAgain && !push.channelBlocked;
}

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

type QuietHoursCardProps = {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  quietHoursWindow: QuietHoursWindow;
  onWindowChange: (next: QuietHoursWindow) => void;
  /**
   * False while the account's first read is in flight. An edit then would be
   * kept only locally (quiet hours read as off until the server answers) and
   * overwritten by the window the read returns, so it would be lost (#2938).
   */
  windowEditable: boolean;
  tokens: SignetTokens;
  styles: ReturnType<typeof createStyles>;
};

function QuietHoursCard({
  enabled,
  onEnabledChange,
  quietHoursWindow,
  onWindowChange,
  windowEditable,
  tokens,
  styles,
}: QuietHoursCardProps) {
  const [draft, setDraft] = useState<QuietHoursWindow>(quietHoursWindow);

  // Re-sync when the effective window changes underneath us: a server hydrate, an
  // edit made on web, or the remembered window being restored on re-enable.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-sync the quiet-hours draft when the effective window changes underneath us
    setDraft(quietHoursWindow);
  }, [quietHoursWindow]);

  // Validate only what the member typed. A stored zone arrives here already
  // accepted by the server (a UTC offset, which it now rejects, arrives already
  // repaired by the sync hook), and this device's tzdata can be older than the
  // server's — so running our own resolvability check over it produces a
  // confident false negative (`Europe/Kyiv` on a build that knows only
  // `Europe/Kiev`). That would strand the member twice over: `commitDraft`
  // reverts on every blur, so they could not edit their times at all, and the
  // only way out — retyping a zone this device knows — would overwrite their
  // correct zone on every other device. Structural checks still apply, because
  // blank and over-length are wrong on any device.
  const trimmedTz = draft.tz.trim();
  const tzEdited = trimmedTz !== quietHoursWindow.tz.trim();
  const tzIsValid =
    trimmedTz.length > 0 &&
    trimmedTz.length <= MAX_TIME_ZONE_LENGTH &&
    (!tzEdited || isSupportedTimeZone(trimmedTz));
  const timesAreValid =
    isValidTimeInput(draft.start.trim()) && isValidTimeInput(draft.end.trim());
  const draftIsValid = timesAreValid && tzIsValid;

  const commitDraft = () => {
    if (!draftIsValid) {
      setDraft(quietHoursWindow);
      return;
    }
    onWindowChange({
      start: draft.start.trim(),
      end: draft.end.trim(),
      tz: draft.tz.trim(),
    });
  };

  return (
    <View style={styles.quietHoursCard}>
      <View style={styles.quietHoursHeaderRow}>
        <View style={styles.toggleTextStack}>
          <Text style={styles.toggleTitle}>Quiet hours</Text>
          {/* The window, and only while it is in force. The label and the
              fields below say what quiet hours are, so a sentence explaining
              them was more words than clarity needs (writing.md §1, "in the
              fewest words that stay clear"). */}
          {enabled ? (
            <Text style={styles.toggleDescription}>
              {`${formatTimeOfDay(quietHoursWindow.start)} – ${formatTimeOfDay(
                quietHoursWindow.end,
              )}`}
            </Text>
          ) : null}
        </View>
        <Toggle
          value={enabled}
          onValueChange={onEnabledChange}
          accessibilityLabel="Quiet hours"
        />
      </View>

      <View style={styles.quietHoursFieldRow}>
        <View style={styles.quietHoursField}>
          <Text style={styles.quietHoursFieldLabel}>Start</Text>
          <TextInput
            value={draft.start}
            onChangeText={(value) =>
              setDraft((current) => ({ ...current, start: value }))
            }
            onBlur={commitDraft}
            editable={windowEditable}
            placeholder="22:00"
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Quiet hours start time"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            style={styles.quietHoursInput}
          />
        </View>
        <View style={styles.quietHoursField}>
          <Text style={styles.quietHoursFieldLabel}>End</Text>
          <TextInput
            value={draft.end}
            onChangeText={(value) =>
              setDraft((current) => ({ ...current, end: value }))
            }
            onBlur={commitDraft}
            editable={windowEditable}
            placeholder="08:00"
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Quiet hours end time"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            style={styles.quietHoursInput}
          />
        </View>
      </View>

      <View style={styles.quietHoursField}>
        <Text style={styles.quietHoursFieldLabel}>Timezone</Text>
        <TextInput
          value={draft.tz}
          onChangeText={(value) =>
            setDraft((current) => ({ ...current, tz: value }))
          }
          onBlur={commitDraft}
          editable={windowEditable}
          placeholder="America/New_York"
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel="Quiet hours timezone"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.quietHoursInput}
        />
      </View>

      {/* Only a problem earns a line here. The steady-state sentences
          ("Applies to this account on every device.", "Saved for when you
          turn quiet hours back on.") narrated how the card works. */}
      {draftIsValid ? null : (
        <Text style={styles.quietHoursHintError}>
          {!timesAreValid
            ? "Use 24-hour HH:mm times (e.g. 21:00)."
            : "Enter a timezone name like America/Chicago."}
        </Text>
      )}
    </View>
  );
}

export default function PreferencesScreen() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
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
  const accentSheetRef = useRef<BottomSheetModal>(null);
  const blockList = useBlockedUserIds();
  const blockedMembersValue =
    blockList.status !== "ready"
      ? "—"
      : blockList.ids.size === 0
        ? "None"
        : String(blockList.ids.size);

  const pushReason = pushUnavailableReason();
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
   *   recorded first, so the s03 card isn't offered afterwards with a
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
        await acceptPrimer();
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
  } = useNotificationPreferencesSync();

  // `can`, never a bare `includes` — an owner's grant is the wildcard `*`, so a
  // membership test would lock out exactly the people this section is for.
  const permissions = usePermissionList();
  const canSeeChapterAdmin = can("chapter-config:view", permissions);
  // The guard on `PATCH /v1/chapters/current`, which the accent save calls.
  const canEditAccent = canAll(CHAPTER_PROFILE_PERMISSIONS, permissions);

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

      <QuietHoursCard
        enabled={quietHoursEnabled}
        onEnabledChange={setQuietHoursEnabled}
        quietHoursWindow={quietHoursWindow}
        onWindowChange={setQuietHoursWindow}
        windowEditable={quietHoursSync !== "loading"}
        tokens={tokens}
        styles={styles}
      />

      <ListSection>
        {shownNotificationCategories().map((category) => (
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
      <Text style={styles.footnote}>
        Chapter announcements can&apos;t be switched off here.
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
      <AccentSheet ref={accentSheetRef} />
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    toggleTextStack: {
      flex: 1,
      gap: tokens.spacing.xs,
      paddingRight: tokens.spacing.md,
    },
    quietHoursCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    quietHoursHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    quietHoursFieldRow: {
      flexDirection: "row",
      gap: tokens.spacing.md,
    },
    quietHoursField: {
      flex: 1,
    },
    quietHoursFieldLabel: {
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.mutedForeground,
    },
    quietHoursInput: {
      marginTop: tokens.spacing.xs,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      // The input step, one below the `card` it sits on, with the input
      // border marking the field.
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    quietHoursHintError: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    toggleTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    toggleDescription: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
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
    swatch: {
      width: tokens.spacing.xl,
      height: tokens.spacing.xl,
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
    },
  });
}
