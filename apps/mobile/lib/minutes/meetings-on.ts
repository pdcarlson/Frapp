import { Alert } from "react-native";
import { useCurrentChapter } from "@repo/hooks";
import { isModuleEnabled } from "@repo/validation";

/**
 * Whether the chapter keeps minutes in Frapp, once the chapter has loaded
 * (`spec/behavior/meetings.md`). False while it loads, and false while the
 * chapter has `meetings` switched off: then no minutes row, screen or entry is
 * drawn anywhere on the phone.
 */
export function useMeetingsOn(): boolean {
  const chapter = useCurrentChapter().data;
  return !!chapter && isModuleEnabled(chapter.enabled_modules, "meetings");
}

/**
 * What an event's `notes` are called (#4934): Notes while the meetings module
 * keeps the minutes as their own record, Meeting minutes while it is off, as
 * web's sheet names them (`spec/behavior/meetings.md` § Where minutes live).
 * Notes until the chapter has loaded, or if it can't: unlike a minutes row,
 * a label has to say something, and minutes are on by default.
 */
export function useNotesLabel(): "Notes" | "Meeting minutes" {
  const chapter = useCurrentChapter().data;
  return !chapter || isModuleEnabled(chapter.enabled_modules, "meetings")
    ? "Notes"
    : "Meeting minutes";
}

/** A yes/no question as the platform's own alert; resolves `true` on yes. */
export function confirmAlert({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  /** The way out that changes nothing: "Keep editing" over unsaved words. */
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
