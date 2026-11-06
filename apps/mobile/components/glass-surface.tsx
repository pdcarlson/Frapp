import { type ReactNode, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { glassFill, signetGlass } from "@repo/theme/glass";
import { useFrappTheme } from "@/lib/theme";

/**
 * How a glass surface draws on this device.
 *
 * - `liquid`: iOS 26's own Liquid Glass (`expo-glass-effect`), which brings its
 *   own refraction, sheen and press response, so nothing is layered on top.
 * - `blur`: a backdrop blur (`expo-blur`) under the `surface1` fill, the edge
 *   and the specular sheen. iOS before 26, and web, where it is CSS
 *   `backdrop-filter`.
 * - `tinted`: no blur, a near-solid `surface1` fill with the edge and sheen.
 *   Android, until each screen is wrapped in the `BlurTargetView` its blur
 *   needs (#3545); a blur with no target draws nothing useful.
 * - `solid`: plain `surface1` and a hairline, nothing see-through. Whenever the
 *   member has Reduce Transparency on.
 */
export type GlassMode = "liquid" | "blur" | "tinted" | "solid";

export function resolveGlassMode({
  os,
  reduceTransparency,
  liquidGlass,
}: {
  os: string;
  reduceTransparency: boolean;
  liquidGlass: boolean;
}): GlassMode {
  if (reduceTransparency) return "solid";
  if (os === "ios") return liquidGlass ? "liquid" : "blur";
  if (os === "web") return "blur";
  return "tinted";
}

/** Whether the member has asked the system for less transparency (iOS). */
export function useReduceTransparency(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceTransparencyEnabled?.()
      .then((value) => {
        if (live) setEnabled(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.(
      "reduceTransparencyChanged",
      (value: boolean) => setEnabled(value),
    );
    return () => {
      live = false;
      subscription?.remove();
    };
  }, []);
  return enabled;
}

export function useGlassMode(): GlassMode {
  const reduceTransparency = useReduceTransparency();
  return resolveGlassMode({
    os: Platform.OS,
    reduceTransparency,
    liquidGlass: Platform.OS === "ios" && safeLiquidGlassAvailable(),
  });
}

function safeLiquidGlassAvailable(): boolean {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
}

type GlassSurfaceProps = {
  /** The shape: size, radius, position. The radius also clips the blur. */
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Forces a mode, for specs and for the board's side-by-side. */
  mode?: GlassMode;
};

/**
 * One piece of floating chrome in the glass recipe (`@repo/theme/glass`).
 * Children render above the glass; the surface itself takes no touches of its
 * own, so a pressable child keeps its full target.
 */
export function GlassSurface({ style, children, mode }: GlassSurfaceProps) {
  const { tokens } = useFrappTheme();
  const resolved = useGlassMode();
  const drawn = mode ?? resolved;
  const surface1 = tokens.color.surface.surface1;
  const flat = StyleSheet.flatten(style) ?? {};
  const radius = typeof flat.borderRadius === "number" ? flat.borderRadius : 0;

  const frame: ViewStyle = {
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor:
      drawn === "solid" ? tokens.color.border.hairline : signetGlass.edge,
    backgroundColor:
      drawn === "solid"
        ? surface1
        : drawn === "tinted"
          ? glassFill(surface1, signetGlass.unblurredFillAlpha)
          : "transparent",
  };

  return (
    <View style={[frame, style]} testID="glass-surface">
      {drawn === "liquid" ? (
        <GlassView
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
          glassEffectStyle="regular"
          colorScheme="dark"
          tintColor={glassFill(surface1, signetGlass.fillAlpha / 2)}
        />
      ) : null}
      {drawn === "blur" ? (
        <>
          <BlurView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            tint="dark"
            intensity={signetGlass.blur * 2}
          />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: glassFill(surface1, signetGlass.fillAlpha) },
            ]}
          />
        </>
      ) : null}
      {drawn === "blur" || drawn === "tinted" ? <Specular /> : null}
      {children}
    </View>
  );
}

/** The sheen: white at 7% across the top, gone by 46% of the height. */
function Specular() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="glass-specular" x1="0" y1="0" x2="0" y2="1">
            <Stop
              offset="0"
              stopColor="#FFFFFF"
              stopOpacity={signetGlass.specular}
            />
            <Stop
              offset={String(signetGlass.specularStop)}
              stopColor="#FFFFFF"
              stopOpacity={0}
            />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#glass-specular)" />
      </Svg>
    </View>
  );
}
