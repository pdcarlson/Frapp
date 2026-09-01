import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  useCurrentChapter,
  useDeleteAccount,
  useGeofences,
  useMyPermissions,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  can,
  isModuleEnabled,
  isSupportedTimeZone,
  MAX_TIME_ZONE_LENGTH,
  NOTIFICATION_CATEGORIES,
} from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { useAuthSession } from "@/lib/auth-session";
import { useChapterBranding } from "@/lib/chapter-branding";
import { shouldShowDonationCta } from "@/lib/more/donation";
import { LEGAL_LINKS } from "@/lib/more/legal";
import {
  getPushPermission,
  pushUnavailableReason,
} from "@/lib/notifications/push";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
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
 * - **`announcements` is not a switch.** The delivery flow checks the member's
 *   preference *before* it checks priority, so the row would let someone
 *   silence URGENT chapter announcements — and the in-app record of them — from
 *   here. See the catalog's docblock in `@repo/validation`.
 * - **Appearance is static text.** The app is dark-only by design
 *   (`lib/theme.tsx`), and Canvas draws this row as a value, not a control.
 * - **"Push notifications" is a status row, not a switch.** Canvas draws a
 *   toggle, but it is a *device* permission: an app cannot turn one off on the
 *   member's behalf, and iOS never re-prompts once asked. So C7 (#998) renders
 *   what is true — granted, off, or unavailable in this build — and sends the
 *   member to the OS settings, which is the only place it can actually change.
 *   TODO-DESIGN: the drawn control is a switch.
 * - **"Mandatory events only" is still not built.** It has no backing field on
 *   `events` and no preference key. The per-category switches below are what the
 *   API actually enforces.
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

type QuietHoursCardProps = {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  quietHoursWindow: QuietHoursWindow;
  onWindowChange: (next: QuietHoursWindow) => void;
  tokens: SignetTokens;
  accent: string;
  styles: ReturnType<typeof createStyles>;
};

function QuietHoursCard({
  enabled,
  onEnabledChange,
  quietHoursWindow,
  onWindowChange,
  tokens,
  accent,
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
  // accepted by the server, and this device's tzdata can be older than the
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
          <Text style={styles.toggleDescription}>
            {enabled
              ? `Silence normal-priority pushes from ${formatTimeOfDay(
                  quietHoursWindow.start,
                )} to ${formatTimeOfDay(quietHoursWindow.end)}.`
              : "Silence normal-priority pushes during a window you choose."}
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onEnabledChange}
          accessibilityLabel="Quiet hours"
          trackColor={{
            false: tokens.color.border.input,
            true: tint(tokens.color.semantic.info, 0.3),
          }}
          thumbColor={enabled ? accent : tokens.color.surface.card}
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
          placeholder="America/New_York"
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel="Quiet hours timezone"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.quietHoursInput}
        />
      </View>

      <Text
        style={
          draftIsValid ? styles.quietHoursHint : styles.quietHoursHintError
        }
      >
        {!timesAreValid
          ? "Use 24-hour HH:mm times (e.g. 21:00)."
          : !tzIsValid
            ? "Enter a timezone name like America/Chicago."
            : enabled
              ? "Applies to this account on every device."
              : "Saved for when you turn quiet hours back on."}
      </Text>
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
   * OS notification permission, read once on mount and again on every
   * foreground.
   *
   * The re-read is the whole point: the only place this setting can actually be
   * changed is the OS settings app, so the member leaves, changes it, and comes
   * back — and a row still reporting the old answer would be worse than no row.
   * `null` while unread, so the row never flashes "Off" at a member who has
   * granted it.
   */
  const [pushGranted, setPushGranted] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void getPushPermission()
        .then((status) => {
          if (!cancelled) setPushGranted(status?.granted ?? null);
        })
        .catch(() => {
          // An unreadable permission is unknown, not "off" — the row says so
          // below rather than telling someone who has granted push to go turn
          // it on. Swallowed rather than surfaced: there is nothing a member
          // can do about it, and an unhandled rejection would be worse.
          if (!cancelled) setPushGranted(null);
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

  const pushReason = pushUnavailableReason();
  const pushStatusValue = pushReason
    ? "Unavailable"
    : pushGranted === null
      ? "—"
      : pushGranted
        ? "On"
        : "Off";
  const pushStatusDescription =
    pushReason ??
    (pushGranted === null
      ? // Unread, not "off". The read is a round trip, so the old truthiness
        // test told every member who had *already* granted push to go and turn
        // it on, for as long as it took to resolve — and permanently if it
        // rejected.
        "Checking…"
      : pushGranted
        ? "Turn off in iOS or Android settings."
        : "Turn on in iOS or Android settings to get chapter alerts.");

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
  const { data: permData } = useMyPermissions();
  const permissions = useMemo(() => {
    const raw = (permData as { permissions?: unknown } | undefined)
      ?.permissions;
    return Array.isArray(raw) ? (raw as string[]) : [];
  }, [permData]);
  const canSeeChapterAdmin = can("chapter-config:view", permissions);

  const chapterQuery = useCurrentChapter();
  const enabledModules = (
    chapterQuery.data as
      { enabled_modules?: Record<string, boolean> } | undefined
  )?.enabled_modules;
  const donationUrl = (
    chapterQuery.data as { donation_url?: string | null } | undefined
  )?.donation_url;
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
              : "Synced with your account.";

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

  function confirmDeleteAccount() {
    // Native `Alert.alert` with a destructive button, per the native-feel table
    // in `spec/ui/mobile/README.md`. `window.confirm` is banned everywhere.
    Alert.alert(
      "Delete account?",
      "This cannot be undone. Your profile and contact details are erased; " +
        "chapter history you took part in stays, anonymized as “Deleted User”. " +
        "See the Privacy Policy for what is kept and for how long.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteAccount.mutate(undefined, {
              onSuccess: () => {
                void handleSignOut();
              },
              onError: () => {
                // The endpoint documents a 502 as "did not finish", and every
                // step is idempotent — so the instruction is retry. It must not
                // also say the account is intact: media is purged and PII is
                // scrubbed *before* the auth record is deleted, so a failure
                // after that point has already destroyed the profile. Telling
                // someone "nothing is lost" there would talk them out of the
                // retry that finishes the job.
                Alert.alert(
                  "Deletion didn't finish",
                  "Part of it may already have gone through, and running it again is safe. Try once more in a moment.",
                );
              },
            });
          },
        },
      ],
    );
  }

  return (
    <ScreenShell
      title="Settings"
      subtitle="Notifications, chapter details, and your account."
    >
      <SectionHeader>Notifications</SectionHeader>

      <ListSection>
        <ListRow
          label="Push notifications"
          value={pushStatusValue}
          description={pushStatusDescription}
          accessibilityHint="Opens this app's settings, where notifications can be turned on or off."
          onPress={() => void Linking.openSettings()}
        />
      </ListSection>

      <QuietHoursCard
        enabled={quietHoursEnabled}
        onEnabledChange={setQuietHoursEnabled}
        quietHoursWindow={quietHoursWindow}
        onWindowChange={setQuietHoursWindow}
        tokens={tokens}
        accent={accent}
        styles={styles}
      />

      <ListSection>
        {NOTIFICATION_CATEGORIES.map((category) => (
          <ListRow
            key={category.key}
            label={category.label}
            description={category.description}
            trailing={
              <Switch
                value={categories[category.key]}
                onValueChange={(value) => setCategory(category.key, value)}
                accessibilityLabel={category.label}
                trackColor={{
                  false: tokens.color.border.input,
                  true: tint(tokens.color.semantic.info, 0.3),
                }}
                thumbColor={
                  categories[category.key] ? accent : tokens.color.surface.card
                }
              />
            }
          />
        ))}
      </ListSection>

      <Text style={styles.footnote}>
        Chapter announcements always arrive — they can carry emergencies, so
        they are not switchable here.
      </Text>
      <Text style={styles.footnote}>{notificationsMeta}</Text>
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
              description="One hex → a full safe scale. The raw color never paints."
              trailing={
                <View
                  accessibilityLabel="Current chapter accent"
                  style={[styles.swatch, { backgroundColor: accent }]}
                />
              }
            />
            {geofencesEnabled ? (
              <ListRow
                label="Study zones"
                value={
                  zoneCount === null
                    ? "—"
                    : `${zoneCount} ${zoneCount === 1 ? "zone" : "zones"}`
                }
              />
            ) : null}
          </ListSection>
          <Text style={styles.footnote}>
            Chapter settings are edited on the web dashboard.
          </Text>
        </>
      ) : null}

      <SectionHeader>Account</SectionHeader>
      <ListSection>
        {/* Static, not a control: Signet is dark-only by design (lib/theme.tsx),
            and Canvas draws this row as a value too. */}
        <ListRow label="Appearance" value="Dark" />
        {showDonationCta ? (
          <ListRow
            label="Support the Chapter"
            description="Opens the chapter's donation page in your browser."
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
          destructive
          onPress={() => {
            void handleSignOut();
          }}
        />
        <ListRow
          label={
            deleteAccount.isPending ? "Deleting account…" : "Delete account"
          }
          destructive
          disabled={deleteAccount.isPending}
          accessibilityHint="Permanently deletes your account. You'll be asked to confirm."
          onPress={confirmDeleteAccount}
        />
      </ListSection>
      {linkFailed ? (
        <Text style={styles.footnoteError}>
          {linkFailed} couldn&apos;t be opened. Try again in a moment.
        </Text>
      ) : null}
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
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
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
      backgroundColor: tokens.color.surface.card,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    quietHoursHint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
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
      ...typeRole(tokens.typography.role.body),
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
