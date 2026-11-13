import { StyleSheet, Text, View } from "react-native";
import { defaultSignupEnd } from "@repo/chat-core/signups";
import { localClock, localIsoDate } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { Toggle } from "@/components/toggle";
import { DueDateField } from "@/components/tasks/due-date-field";
import { DueTimeField } from "@/components/tasks/due-time-field";

/**
 * A card's optional end time, the phone's twin of web's `EndTimeField`
 * (`apps/web/components/chat/signup-form.tsx`): a switch that turns one on,
 * starting tomorrow at 6 PM (`defaultSignupEnd`), and the New task sheet's
 * platform date and time fields to move it. Clearing the time takes the end
 * time off. The New sign-up sheet ("Ends at a set time") and the New form
 * sheet ("Closes at a set time") both draw it, so the two can't drift.
 */
export function EndTimeField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: Date | null;
  onChange: (next: Date | null) => void;
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Toggle
          value={value !== null}
          accessibilityLabel={label}
          onValueChange={(on) => {
            if (disabled) return;
            onChange(on ? defaultSignupEnd(new Date()) : null);
          }}
        />
      </View>
      {value ? (
        <View style={styles.endRow}>
          <DueDateField
            value={localIsoDate(value)}
            today={localIsoDate(new Date())}
            disabled={disabled}
            onChange={(day) => onChange(withDay(value, day))}
          />
          <DueTimeField
            value={localClock(value)}
            suggested="18:00"
            disabled={disabled}
            // Clearing the time takes the end time off.
            onChange={(time) =>
              onChange(time === null ? null : withTime(value, time))
            }
          />
        </View>
      ) : null}
    </>
  );
}

/** The end time moved to another day (`YYYY-MM-DD`), its time kept. */
export function withDay(at: Date, day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return at;
  const next = new Date(at);
  next.setFullYear(y, m - 1, d);
  return next;
}

/** The end time moved to another time of day (`HH:MM`), its day kept. */
export function withTime(at: Date, time: string): Date {
  const [hh, mm] = time.split(":").map(Number);
  if (hh === undefined || mm === undefined || Number.isNaN(hh + mm)) return at;
  const next = new Date(at);
  next.setHours(hh, mm, 0, 0);
  return next;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      marginTop: tokens.spacing.xs,
    },
    toggleLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    endRow: {
      gap: tokens.spacing.sm,
    },
  });
}
