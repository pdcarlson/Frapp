import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import {
  useAttendance,
  useEvent,
  useMintCheckInToken,
  usePermissionList,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { can } from "@repo/validation";
import { formatCountdown } from "@/lib/events/format";
import {
  countCheckedIn,
  selectEventDetail,
  selectMintedToken,
} from "@/lib/events/select";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s22 — Host check-in, admin (`canvas-screens.dc.html:704`).
 *
 * An officer projects this; members scan it with s18. The code rotates every 30
 * seconds and the server accepts the current and previous window, so a scan
 * racing a rotation still lands (`spec/ui/mobile/patterns.md`).
 *
 * ## The QR is dark-on-white even though the app is dark-only
 *
 * `patterns.md`: "QR rendering is always dark-on-white (s22: white card on the
 * dark screen), even in dark UI. Scan reliability beats theme purity." Camera
 * decoders expect dark modules on a light background; inverting for the theme
 * costs real scans in a dim room. This is the one place in the app where a
 * hardcoded white is correct — and it is a *canvas* for a machine-read code,
 * not chrome, so it does not breach the no-raw-hex rule for screen styling.
 *
 * ## Not on ScreenShell
 *
 * The QR needs to be as large as the screen allows so it scans from across a
 * room; the shell's padded, max-width ScrollView actively works against that.
 */

const QR_SIZE = 260;

/** Ticks the countdown between refetches. The token itself comes from the
 * server — this only animates the gap. */
function useCountdown(expiresAt: string | undefined): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!expiresAt) return;
    const deadline = new Date(expiresAt).getTime();
    if (Number.isNaN(deadline)) return;

    const tick = () => setRemaining(deadline - Date.now());
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [expiresAt]);

  return remaining;
}

export default function HostCheckInScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();

  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const eventId = Array.isArray(params.eventId)
    ? params.eventId[0]
    : (params.eventId ?? "");

  // `can` from @repo/validation, not a local `includes` — an owner's grant is
  // the wildcard `*`, so a bare membership test would lock out exactly the
  // people most likely to be hosting.
  const permissions = usePermissionList();
  const canHost = can("events:update", permissions);

  const eventQuery = useEvent(eventId);
  const event = useMemo(
    () => selectEventDetail(eventQuery.data),
    [eventQuery.data],
  );

  // Both requests are officer-gated, so neither is fired for a member who would
  // only get a 403 back.
  const tokenQuery = useMintCheckInToken(eventId, canHost);
  const { data: attendance } = useAttendance(canHost ? eventId : "");

  const minted = useMemo(
    () => selectMintedToken(tokenQuery.data),
    [tokenQuery.data],
  );
  const remaining = useCountdown(minted?.expiresAt);
  const checkedIn = countCheckedIn(attendance);

  // The API's error bodies carry `statusCode`; anything else stays null so the
  // copy below falls through to the transient wording rather than guessing.
  const tokenStatus = ((): number | null => {
    // `unknown` first: TanStack types the error as `Error`, but what actually
    // lands here is the API's JSON body, which is not an Error instance.
    const raw = tokenQuery.error as unknown;
    if (!raw || typeof raw !== "object") return null;
    const code = (raw as { statusCode?: unknown }).statusCode;
    return typeof code === "number" ? code : null;
  })();

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="End hosting and go back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.end, pressed ? styles.pressed : null]}
        >
          <Text style={styles.endText}>✕ End</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {event?.name ?? "Host check-in"}
        </Text>
        <View style={styles.end} />
      </View>

      {!eventId ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>No event selected</Text>
          <Text style={styles.stateBody}>
            Open an event first, then start hosting its check-in.
          </Text>
        </View>
      ) : !canHost ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>Officers only</Text>
          <Text style={styles.stateBody}>
            Displaying the check-in code needs the events permission. Ask an
            officer to host, and check in by scanning their code.
          </Text>
        </View>
      ) : tokenQuery.isPending ? (
        <View style={styles.stateBlock}>
          <ActivityIndicator color={tokens.color.text.muted} />
          <Text style={styles.stateBody}>Preparing the code…</Text>
        </View>
      ) : tokenQuery.isError || !minted ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>Code unavailable</Text>
          {/*
            Two genuinely different causes, and the screen must not assert the
            wrong one. A 503 means the environment has no signing secret and no
            amount of waiting fixes it; anything else (a network blip, a 5xx) is
            transient and the 10s poll will clear it on its own. Naming
            "not configured" for a dropped request would send an officer to
            chase an infra problem that does not exist.
          */}
          <Text style={styles.stateBody}>
            {tokenStatus === 503
              ? "Rotating check-in codes aren't configured for this environment."
              : "The code couldn't be loaded just now — retrying."}
          </Text>
          <Text style={styles.stateBody}>
            Members can still check in from the event screen.
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.qrCard}>
            <QRCode
              value={minted.qrPayload}
              size={QR_SIZE}
              // Explicit, not inherited: see the header note on why this stays
              // dark-on-white regardless of the app's dark-only theme.
              color="#000000"
              backgroundColor="#FFFFFF"
            />
          </View>

          <Text style={styles.rotates}>
            Rotates in {formatCountdown(remaining)}
          </Text>

          {checkedIn !== null ? (
            <Text style={styles.count}>{checkedIn} checked in</Text>
          ) : null}

          <View style={styles.manualCard}>
            <Text style={styles.manualLabel}>Manual override</Text>
            <Text style={styles.manualCode}>
              Show code: {minted.manualCode}
            </Text>
            <Text style={styles.manualHint}>
              For members whose camera won&apos;t scan. This code rotates with
              the QR.
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      gap: tokens.spacing.sm,
    },
    end: {
      width: 64,
    },
    endText: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.label),
    },
    headerTitle: {
      flex: 1,
      textAlign: "center",
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    body: {
      flex: 1,
      alignItems: "center",
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    qrCard: {
      marginTop: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      backgroundColor: "#FFFFFF",
      padding: tokens.spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    rotates: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    count: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.title),
    },
    manualCard: {
      width: "100%",
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.md,
      gap: tokens.spacing.xs,
    },
    manualLabel: {
      color: tokens.color.text.muted,
      ...typeRole(tokens.typography.role.caption),
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    manualCode: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    manualHint: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.caption),
    },
    stateBlock: {
      margin: tokens.spacing.lg,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
      alignItems: "flex-start",
    },
    stateTitle: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    stateBody: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
