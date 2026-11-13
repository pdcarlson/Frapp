import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useFrappTheme } from "@/lib/theme";

/**
 * A ring that fills clockwise from twelve o'clock (#4766): Activity's week
 * ring, and the small gauges of its semester strip. The meter's recipe
 * (`components/meter.ts`) bent round: a groove in the page background, since
 * a ring is drawn on a card, and the caller's colour as its fill (the chapter
 * accent, or the success hue once it closes).
 *
 * Decoration: the count beside or inside it says the number, so the ring is
 * hidden from a screen reader and whatever holds it carries the sentence.
 */
export function ProgressRing({
  size,
  stroke,
  progress,
  color,
  children,
  testID,
}: {
  size: number;
  stroke: number;
  /** 0 to 1. Nothing is drawn at 0, so an empty ring is only its groove. */
  progress: number;
  color: string;
  /** Drawn centred inside the ring. */
  children?: ReactNode;
  testID?: string;
}) {
  const { tokens } = useFrappTheme();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(1, Math.max(0, progress));
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={tokens.color.surface.background}
          strokeWidth={stroke}
          fill="none"
        />
        {filled > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * filled} ${circumference}`}
            fill="none"
            // From twelve o'clock, not three.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {children ? <View style={styles.center}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
