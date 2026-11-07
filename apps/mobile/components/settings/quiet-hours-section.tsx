import { useEffect, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { timeZoneCity } from "@repo/validation";
import { ListRow, ListSection } from "@/components/list-section";
import { Toggle } from "@/components/toggle";
import { useChapterBranding } from "@/lib/chapter-branding";
import type { QuietHoursWindow } from "@/lib/use-notification-preferences-sync";

/**
 * Quiet hours on s16 Settings (2026-11-06 rebuild, from the owner's iOS
 * testing: "No need to show times if it's off").
 *
 * - **Off, it is one row.** The switch, and nothing under it. The window is
 *   still remembered (the sync hook keeps it), so turning quiet hours back on
 *   restores the member's times.
 * - **On, two time rows** in the same grouped list, each opening the
 *   platform's own time picker: the compact iOS picker (a pill that opens the
 *   wheel in place) and the Android clock dialog. Nothing is typed, so there is
 *   no format to get wrong and no error line to show.
 * - **The time zone is the phone's**, and is not a field. A member who has
 *   never set a window gets this phone's zone (the hook's default), so the zone
 *   row only appears when the stored zone is a different one (set on web, or
 *   on a phone in another zone). Tapping it offers to switch to this phone's
 *   zone. The stored zone is never replaced without that tap: this device's
 *   tzdata can be older than the server's, so silently "fixing" a zone would
 *   overwrite a correct one on every device
 *   (`spec/behavior/notifications.md` § Quiet Hours).
 */

/** How long the iOS wheel must rest before a change is saved. */
export const QUIET_HOURS_COMMIT_DELAY_MS = 700;

/** "22:00" -> "10:00 PM". Falls back to the raw value for anything unparseable. */
export function formatTimeOfDay(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hours = Number(match[1]);
  if (hours > 23 || Number(match[2]) > 59) return value;
  const suffix = hours < 12 ? "AM" : "PM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${match[2]} ${suffix}`;
}

/**
 * "22:00" as 10 PM on this phone's clock. The picker shows and returns
 * wall-clock time, and the window is wall-clock time in its own zone, so only
 * the hours and minutes carry over; the date and the phone's zone don't matter.
 */
export function timeOfDayToDate(value: string): Date {
  const [hours, minutes] = value.split(":").map(Number);
  // A fixed mid-January day rather than today, so no wall-clock time falls in
  // a daylight-saving gap: on a spring-forward day `02:30` would read back as
  // `03:30` and be saved that way on OK.
  return new Date(
    2001,
    0,
    15,
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
  );
}

/** A picked `Date` back to `HH:mm`, read off the same wall clock. */
export function dateToTimeOfDay(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

type QuietHoursSectionProps = {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  quietHoursWindow: QuietHoursWindow;
  onWindowChange: (next: QuietHoursWindow) => void;
  /** This phone's zone (`deviceTimeZone()` in the sync hook). */
  deviceTimeZone: string;
  /**
   * A window is stored with no zone, so the server runs it in UTC. The row
   * says so and offers this phone's zone, like a stored zone that differs.
   */
  storedZoneMissing?: boolean;
  /**
   * False while the account's first read is in flight. An edit then would be
   * kept only locally and overwritten by the window the read returns (#2938).
   */
  windowEditable: boolean;
};

export function QuietHoursSection({
  enabled,
  onEnabledChange,
  quietHoursWindow,
  onWindowChange,
  deviceTimeZone,
  storedZoneMissing = false,
  windowEditable,
}: QuietHoursSectionProps) {
  const zoneInForce = storedZoneMissing ? "UTC" : quietHoursWindow.tz;
  const zoneDiffers = zoneInForce !== deviceTimeZone;

  function confirmUsePhoneZone() {
    const city = timeZoneCity(deviceTimeZone);
    Alert.alert(
      "Use this phone's time zone?",
      `Quiet hours will follow ${city} time on every device.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `Use ${city}`,
          onPress: () =>
            onWindowChange({ ...quietHoursWindow, tz: deviceTimeZone }),
        },
      ],
    );
  }

  return (
    <ListSection>
      <ListRow
        label="Quiet hours"
        trailing={
          <Toggle
            value={enabled}
            onValueChange={onEnabledChange}
            accessibilityLabel="Quiet hours"
          />
        }
      />
      {enabled ? (
        <>
          <QuietHoursTimeRow
            label="From"
            value={quietHoursWindow.start}
            editable={windowEditable}
            onChange={(start) => onWindowChange({ ...quietHoursWindow, start })}
          />
          <QuietHoursTimeRow
            label="To"
            value={quietHoursWindow.end}
            editable={windowEditable}
            onChange={(end) => onWindowChange({ ...quietHoursWindow, end })}
          />
          {zoneDiffers ? (
            <ListRow
              label="Time zone"
              value={timeZoneCity(zoneInForce)}
              description={`This phone is on ${timeZoneCity(deviceTimeZone)} time.`}
              disabled={!windowEditable}
              onPress={confirmUsePhoneZone}
            />
          ) : null}
        </>
      ) : null}
    </ListSection>
  );
}

type QuietHoursTimeRowProps = {
  label: string;
  /** `HH:mm`. */
  value: string;
  editable: boolean;
  onChange: (next: string) => void;
};

/**
 * One time row. iOS draws the compact picker as the row's trailing control;
 * Android has no compact picker, so the row shows the time and a tap opens
 * the clock dialog, which saves on OK.
 */
function QuietHoursTimeRow({
  label,
  value,
  editable,
  onChange,
}: QuietHoursTimeRowProps) {
  const { accentPrimary } = useChapterBranding();
  const accessibilityLabel = `Quiet hours ${label === "From" ? "start" : "end"}`;

  // The iOS wheel reports every position it passes through. Saving each would
  // send a burst of PATCHes whose order the network doesn't promise, so the
  // row shows the wheel's value at once and saves it once the wheel rests.
  //
  // Nothing is saved on unmount. The rows unmount when the switch turns quiet
  // hours off, and a save then would come from a render where they were still
  // on, so it would switch them straight back on. A spin abandoned within the
  // delay by leaving the screen is the accepted cost.
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  }, [value, onChange]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // A server answer replaces the draft once nothing is waiting to save.
  useEffect(() => {
    if (pending.current === null) setDraft(null);
  }, [value]);

  function scheduleCommit(next: string) {
    setDraft(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const toSave = pending.current;
      pending.current = null;
      // Compared with the value in force now, not when the spin began: the
      // window can change underneath (a save on web). A change saves and the
      // new value clears the draft; no change clears it here.
      if (toSave !== null && toSave !== latest.current.value) {
        latest.current.onChange(toSave);
      } else {
        setDraft(null);
      }
    }, QUIET_HOURS_COMMIT_DELAY_MS);
  }

  const shown = draft ?? value;

  if (Platform.OS === "android") {
    return (
      <ListRow
        label={label}
        value={formatTimeOfDay(value)}
        disabled={!editable}
        action
        onPress={() =>
          DateTimePickerAndroid.open({
            value: timeOfDayToDate(value),
            mode: "time",
            is24Hour: false,
            onChange: (event: DateTimePickerEvent, date?: Date) => {
              if (event.type !== "set" || !date) return;
              const next = dateToTimeOfDay(date);
              if (next !== value) onChange(next);
            },
          })
        }
      />
    );
  }

  return (
    <ListRow
      label={label}
      trailing={
        <DateTimePicker
          testID={accessibilityLabel}
          accessibilityLabel={accessibilityLabel}
          value={timeOfDayToDate(shown)}
          mode="time"
          display="compact"
          themeVariant="dark"
          accentColor={accentPrimary}
          disabled={!editable}
          onChange={(event: DateTimePickerEvent, date?: Date) => {
            if (event.type !== "set" || !date) return;
            scheduleCommit(dateToTimeOfDay(date));
          }}
        />
      }
    />
  );
}
