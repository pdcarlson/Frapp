import { useEffect, useRef } from "react";
import {
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** The viewport's largest side: a code across the room still fills it. */
const VIEWPORT_MAX = 280;

/**
 * s18's Scan code (0.13.0): a square camera viewport that reads QR codes and
 * hands each one's text to `onScan`, which decides whether it is a check-in.
 *
 * The phone's own camera reads the same code as a link (#4762); this is for a
 * member already in the app, the way Venmo and Cash App offer a Scan button
 * beside the camera path. The camera is asked for each time the member opens
 * the viewport (tapping Scan code), and only once while it is open, so a
 * "Don't allow" is never asked again in a loop; after that the viewport says
 * what to change and offers the OS prompt again, or Settings once the OS won't
 * ask. On Android it reads the permission again when the member comes back
 * from Settings; iOS restarts the app when a permission changes there.
 *
 * `active` is false while the screen is covered or blurred: the camera
 * session is unmounted then, so it doesn't run behind another screen.
 */
export function CheckInScanner({
  active,
  onScan,
}: {
  active: boolean;
  onScan: (data: string) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [permission, requestPermission, getPermission] = useCameraPermissions();

  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current || !permission || permission.granted) return;
    if (!permission.canAskAgain) return;
    askedRef.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  // Settings changes nothing the hook hears about, so read it again on return.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void getPermission();
    });
    return () => subscription.remove();
  }, [getPermission]);

  const granted = permission?.granted ?? false;
  const settings = permission !== null && !granted && !permission.canAskAgain;

  return (
    <View style={styles.frame}>
      {granted ? (
        active ? (
          <CameraView
            style={styles.camera}
            facing="back"
            // Only QR: the decoder stays off every other barcode in the room.
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(result) => onScan(result.data ?? "")}
            accessibilityLabel="Camera. Point it at the check-in code."
          />
        ) : null
      ) : permission ? (
        <View style={styles.fallback}>
          <Text style={styles.fallbackTitle}>Camera is off for Frapp</Text>
          <Text style={styles.fallbackBody}>
            {settings
              ? "Allow the camera in Settings, or enter the code instead."
              : "Allow the camera to scan, or enter the code instead."}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              settings ? void Linking.openSettings() : void requestPermission()
            }
            hitSlop={tokens.spacing.sm}
            style={({ pressed }) => [
              styles.fallbackAction,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.fallbackActionText}>
              {settings ? "Open Settings" : "Allow camera"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    frame: {
      width: "100%",
      maxWidth: VIEWPORT_MAX,
      aspectRatio: 1,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      overflow: "hidden",
    },
    camera: {
      flex: 1,
    },
    fallback: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: tokens.spacing.md,
      gap: tokens.spacing.xs,
    },
    fallbackTitle: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
      textAlign: "center",
    },
    fallbackBody: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.caption),
      textAlign: "center",
    },
    fallbackAction: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      alignItems: "center",
    },
    fallbackActionText: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
