import { Image, type ImageSourcePropType } from "react-native";

/**
 * What the native splash draws, so the launch logo (`components/launch-cover.tsx`)
 * and the update reload screen (`lib/updates/use-resume-updates.ts`) draw the
 * same pixels in the same place and the hand-off between them can't be seen
 * (#5449). `app.json`'s `expo-splash-screen` entry is the native side, and
 * `launch-look.spec.ts` holds these to it.
 *
 * The background is the splash's `#0A0A0A`, not the app's surface token: the
 * native splash can only change with a new `expo.version` (#4392), and until
 * then a logo on the token would step in colour as the splash hid. The logo
 * fades out onto the app's own background.
 */
export const LAUNCH_BACKGROUND = "#0A0A0A";

/** Width and height, in points (dp on Android), centred on the screen. */
export const LAUNCH_EMBLEM_SIZE = 200;

/**
 * Locked emblem B as the splash draws it (ADR-25); animated, never redrawn.
 * A Metro asset id, required when asked for: a static import fails `tsc` (no
 * `*.png` module declaration), as in `(auth)/sign-in.tsx`, and a require at
 * module scope would load the PNG in every spec that imports this file.
 */
export function launchEmblem(): ImageSourcePropType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../../assets/images/splash-icon.png") as ImageSourcePropType;
}

const LOADABLE_URL = /^(file|https?|data):/i;

/**
 * The emblem as expo-updates' reload screen takes it: a URL and a size in
 * points, so it draws at the splash's size rather than the file's 1024px.
 *
 * Only a URL the native screen can load. Android's reload screen decodes
 * `file`, `http(s)` and `data` URLs; an asset still embedded in the APK
 * resolves to a bare resource name, which it can't, and a failed image there
 * turns its spinner on whatever the options say (expo-updates 57,
 * `ReloadScreenView.kt`). That reload keeps the plain background instead, and
 * the launch logo draws the emblem as the new code starts.
 */
export function reloadScreenEmblem(): {
  url: string;
  width: number;
  height: number;
  scale: number;
} | null {
  const resolved = Image.resolveAssetSource(launchEmblem());
  if (!resolved?.uri || !LOADABLE_URL.test(resolved.uri)) return null;
  return {
    url: resolved.uri,
    width: LAUNCH_EMBLEM_SIZE,
    height: LAUNCH_EMBLEM_SIZE,
    scale: 1,
  };
}
