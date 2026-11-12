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

/** A yes/no question as the platform's own alert; resolves `true` on yes. */
export function confirmAlert({
  title,
  body,
  confirmLabel,
  destructive = false,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
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
