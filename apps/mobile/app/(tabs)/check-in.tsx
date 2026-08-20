import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useCheckIn, useEvent } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  isPlausibleManualCode,
  parseCheckInCode,
} from "@/lib/events/check-in-code";
import { createScanLatch } from "@/lib/events/scan-latch";
import { serverMessageOf, statusOf } from "@repo/api-sdk";
import { requireForegroundFix } from "@/lib/location";
import { selectEventDetail } from "@/lib/events/select";
import { useConnection } from "@/lib/connection/use-connection";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s18 — QR check-in scanner (`canvas-screens.dc.html:600`).
 *
 * Deliberately not on `ScreenShell`: the shell wraps children in a `ScrollView`,
 * and a full-bleed camera viewport inside a scroll container fights the scroll
 * gesture and cannot fill the screen. s05 opts out for the same class of reason
 * (`spec/ui/mobile/patterns.md`).
 *
 * ## What this screen claims, and what is actually enforced
 *
 * The reference draws "Geofence is the real check — screenshots don't work."
 * That sentence is only true for an event that *has* a zone, and zones are
 * opt-in per event. Rendering it unconditionally would be a security claim
 * about a check that is not running, so the line is bound to
 * `event.hasCheckInZone`. The server is the authority either way — it rejects
 * an out-of-zone or unlocated check-in regardless of what this screen says.
 */

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

function errorMessage(error: unknown, fallback: string): string {
  if (statusOf(error) === 409) {
    return "You're already checked in for this event.";
  }
  return serverMessageOf(error) ?? fallback;
}

export default function CheckInScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const router = useRouter();

  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const eventId = Array.isArray(params.eventId)
    ? params.eventId[0]
    : (params.eventId ?? "");

  const eventQuery = useEvent(eventId);
  const event = useMemo(
    () => selectEventDetail(eventQuery.data),
    [eventQuery.data],
  );
  const needsLocation = event?.hasCheckInZone ?? false;

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [manualCode, setManualCode] = useState("");

  const checkIn = useCheckIn();

  // One latch for the life of the screen. `useRef` rather than state: a latch
  // change must never trigger a render, or the camera remounts mid-scan.
  const latchRef = useRef(createScanLatch());
  // Last foreign-event code already reported — see `handleBarcode`.
  const reportedForeignRef = useRef<string | null>(null);

  /**
   * Check-in has **no outbox** — a submit with no network is lost, and a member
   * standing at the door would believe they had checked in. That is why
   * `spec/ui/resilience.md` § 2's "Disabled with tooltip: 'Reconnect to make
   * changes'" applies here (#501) while the chat composer does the opposite:
   * chat has a queue, this does not.
   *
   * Read through a ref as well, because `handleBarcode` is a `useCallback` the
   * camera holds for the life of the screen — reading the value directly there
   * would close over whatever it was when the callback was built.
   */
  const { writeBlockedReason } = useConnection();
  const writeBlockedReasonRef = useRef(writeBlockedReason);
  writeBlockedReasonRef.current = writeBlockedReason;

  /**
   * Read the member's position, but only when the event actually has a zone.
   * Asking for location on an unzoned event would be a permission prompt with
   * no purpose.
   *
   * The permission-and-accuracy rules moved to `lib/location.ts` when s10 grew
   * a second caller for them — the "no background location" ban binds every
   * surface, and one module asking is easier to keep honest than two.
   */
  const resolveLocation = useCallback(async () => {
    if (!needsLocation) return {};

    return requireForegroundFix(
      "This event checks you in by location. Allow location access to check in.",
    );
  }, [needsLocation]);

  const submit = useCallback(
    async (payload: { token?: string; manualCode?: string }) => {
      setStatus({ kind: "submitting" });
      try {
        const fix = await resolveLocation();
        await checkIn.mutateAsync({ eventId, ...payload, ...fix });
        setStatus({
          kind: "success",
          message: event?.point_value
            ? `You're checked in. +${event.point_value} pts`
            : "You're checked in.",
        });
      } catch (error) {
        setStatus({
          kind: "error",
          message: errorMessage(error, "Couldn't check you in."),
        });
      } finally {
        // Released on both paths so a failed scan can be retried. A latch that
        // stayed closed after an error would strand the member on a dead screen.
        latchRef.current.release();
      }
    },
    [checkIn, event?.point_value, eventId, resolveLocation],
  );

  const handleBarcode = useCallback(
    (result: { data?: string }) => {
      const raw = result?.data ?? "";
      const parsed = parseCheckInCode(raw);
      // Not one of our codes: drop it without latching, so the camera stays
      // live for the real one. A poster in frame must not block the scan.
      if (!parsed) return;

      if (parsed.eventId !== eventId) {
        // Report a foreign code once, not once per frame. `onBarcodeScanned`
        // fires continuously while a code is held in view, so an unconditional
        // `setStatus` here re-renders at camera frame rate for as long as the
        // wrong code is on screen. Remembering the last one reported collapses
        // that to a single message while still reacting to a *different* wrong
        // code. Deliberately not the scan latch: that one gates in-flight
        // submissions, and borrowing it here would block the real code.
        if (reportedForeignRef.current !== raw) {
          reportedForeignRef.current = raw;
          setStatus({
            kind: "error",
            message: "That code is for a different event.",
          });
        }
        return;
      }

      if (!latchRef.current.accept(raw)) return;
      // The manual field is gated a few lines below; the scan has to be too.
      // A scan submits immediately rather than latching, so without this a
      // member at the door with no signal gets a spinner that never resolves
      // and a decoder that has already been switched off.
      if (writeBlockedReasonRef.current !== null) return;
      void submit({ token: parsed.token });
    },
    [eventId, submit],
  );

  useEffect(() => {
    if (!cameraPermission || cameraPermission.granted) return;
    if (!cameraPermission.canAskAgain) return;
    void requestCameraPermission();
  }, [cameraPermission, requestCameraPermission]);

  const scanning = status.kind !== "submitting" && status.kind !== "success";

  const manualSubmitDisabled =
    !isPlausibleManualCode(manualCode) ||
    writeBlockedReason !== null ||
    status.kind === "submitting" ||
    checkIn.isPending;

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close check-in"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.close,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Check in</Text>
        <View style={styles.close} />
      </View>

      {!eventId ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>No event selected</Text>
          <Text style={styles.stateBody}>
            Open an event first, then tap Scan QR to check in.
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={styles.prompt}>Point at the code up front</Text>

          <View style={styles.viewport}>
            {cameraPermission?.granted ? (
              <CameraView
                style={styles.camera}
                facing="back"
                // Only QR: narrowing the symbologies keeps the decoder off
                // every barcode in the room.
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={scanning ? handleBarcode : undefined}
              />
            ) : (
              <View style={styles.cameraFallback}>
                <Text style={styles.stateTitle}>Camera unavailable</Text>
                <Text style={styles.stateBody}>
                  {cameraPermission && !cameraPermission.canAskAgain
                    ? "Allow camera access in Settings, or enter the code below."
                    : "Grant camera access, or enter the code below."}
                </Text>
              </View>
            )}
          </View>

          {/*
            The zone line, and only when there is a zone. `event.check_in_zone_name`
            is what makes the drawn "Inside the Great Hall zone" possible.
          */}
          {needsLocation ? (
            <Text style={styles.zoneLine}>
              {event?.check_in_zone_name
                ? `You must be inside the ${event.check_in_zone_name} zone.`
                : "You must be at the event location."}
            </Text>
          ) : null}

          <Text style={styles.hint}>
            {needsLocation
              ? "Code rotates every 30s. Your location is the real check — screenshots don't work."
              : "Code rotates every 30s, so a screenshot goes stale quickly."}
          </Text>

          {status.kind === "submitting" ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={tokens.color.text.muted} />
              <Text style={styles.stateBody}>Checking you in…</Text>
            </View>
          ) : status.kind === "success" ? (
            <Text style={styles.success}>{status.message}</Text>
          ) : status.kind === "error" ? (
            <Text style={styles.error}>{status.message}</Text>
          ) : null}

          {/* Stated, not just implied by a greyed button (components.md §5). */}
          {writeBlockedReason ? (
            <Text style={styles.error}>{writeBlockedReason}</Text>
          ) : null}

          <View style={styles.manualBlock}>
            <Text style={styles.manualLabel}>Enter code manually</Text>
            <View style={styles.manualRow}>
              <TextInput
                accessibilityLabel="Manual check-in code"
                value={manualCode}
                onChangeText={setManualCode}
                placeholder="4KQ-88"
                placeholderTextColor={tokens.color.text.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.manualInput}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Submit manual check-in code"
                // `checkIn.isPending` as well as the local status: `setStatus`
                // is asynchronous, so a fast double-tap can land a second press
                // before the re-render disables the control. The mutation's own
                // pending flag closes that window.
                disabled={manualSubmitDisabled}
                accessibilityHint={writeBlockedReason ?? undefined}
                onPress={() => void submit({ manualCode })}
                style={({ pressed }) => [
                  styles.manualButton,
                  manualSubmitDisabled ? styles.manualDisabled : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.manualButtonText}>Check in</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
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
    close: {
      width: 32,
      alignItems: "flex-start",
    },
    closeText: {
      color: tokens.color.text.foreground,
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
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    prompt: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.body),
      textAlign: "center",
    },
    viewport: {
      flex: 1,
      minHeight: 260,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      overflow: "hidden",
    },
    camera: {
      flex: 1,
    },
    cameraFallback: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    zoneLine: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.body),
      textAlign: "center",
    },
    hint: {
      color: tokens.color.text.muted,
      ...typeRole(tokens.typography.role.caption),
      textAlign: "center",
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.sm,
    },
    success: {
      color: tokens.color.semantic.success,
      ...typeRole(tokens.typography.role.label),
      textAlign: "center",
    },
    error: {
      color: tokens.color.semantic.destructive,
      ...typeRole(tokens.typography.role.body),
      textAlign: "center",
    },
    manualBlock: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    manualLabel: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.caption),
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    manualRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    manualInput: {
      flex: 1,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.body),
    },
    manualButton: {
      borderRadius: tokens.radius.chip,
      backgroundColor: accent,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
    },
    manualDisabled: {
      opacity: 0.45,
    },
    manualButtonText: {
      color: tokens.color.surface.background,
      ...typeRole(tokens.typography.role.label),
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
      textAlign: "center",
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
