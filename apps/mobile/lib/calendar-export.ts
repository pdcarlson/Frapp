import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

type CalendarExportInput = {
  title: string;
  description: string;
  location: string;
  startAtIso: string;
  endAtIso: string;
  deepLinkUrl: string;
};

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toIcsTimestamp(isoString: string): string {
  return new Date(isoString).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildIcsContent(input: CalendarExportInput): string {
  const now = toIcsTimestamp(new Date().toISOString());
  const startAt = toIcsTimestamp(input.startAtIso);
  const endAt = toIcsTimestamp(input.endAtIso);
  const uid = `${startAt}-${escapeIcsText(input.title)}@frapp.live`;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Frapp//Chapter Events//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${startAt}`,
    `DTEND:${endAt}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(`${input.description}\\n${input.deepLinkUrl}`)}`,
    `LOCATION:${escapeIcsText(input.location)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadCalendarOnWeb(icsContent: string, filename: string) {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function exportEventToCalendar(
  input: CalendarExportInput,
): Promise<boolean> {
  const icsContent = buildIcsContent(input);
  const filename = `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "frapp-event"}.ics`;

  if (Platform.OS === "web" && typeof document !== "undefined") {
    downloadCalendarOnWeb(icsContent, filename);
    return true;
  }

  const exportDirectory =
    FileSystem.cacheDirectory ?? FileSystem.documentDirectory;

  if (!exportDirectory) {
    return false;
  }

  const fileUri = `${exportDirectory}${filename}`;

  try {
    await FileSystem.writeAsStringAsync(fileUri, icsContent, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    if (!(await Sharing.isAvailableAsync())) {
      return false;
    }

    await Sharing.shareAsync(fileUri, {
      dialogTitle: "Export event calendar file",
      mimeType: "text/calendar",
      UTI: "public.calendar-event",
    });

    return true;
  } catch {
    return false;
  }
}
