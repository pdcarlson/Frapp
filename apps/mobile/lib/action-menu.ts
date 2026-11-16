/**
 * The phone's one action menu (#5168): iOS's action sheet, or Android's
 * dialog, whose Cancel is a tap outside or back (`cancelable`). Every `⋯` and
 * long-press menu in the app opens through here, so the two platforms'
 * plumbing (Cancel last on iOS, its index, the destructive rows) is written
 * once.
 *
 * A row runs its `onPress` when tapped on either platform. iOS lists the rows
 * then Cancel; Android lists them as the dialog's buttons. The `android`
 * options cover what a menu draws differently there: its own title or
 * message, its own row order, an explicit Cancel button, or a cap on the
 * buttons (Android's dialog draws at most three and drops the rest).
 */
import {
  ActionSheetIOS,
  Alert,
  Platform,
  type AlertButton,
} from "react-native";

interface ActionMenuRow {
  label: string;
  /**
   * `destructive` draws the row red on both platforms. `default` is the same
   * as leaving it out, except that Android's button carries the style
   * explicitly.
   */
  style?: "default" | "destructive";
  onPress: () => void;
}

export interface ActionMenu {
  title?: string;
  message?: string;
  rows: readonly ActionMenuRow[];
  /** iOS's last row. Defaults to "Cancel". */
  cancelLabel?: string;
  /** iOS only. Left out, the sheet follows the system's appearance. */
  userInterfaceStyle?: "light" | "dark";
  android?: {
    /** Replaces `title` on Android. */
    title?: string;
    /** Replaces `message` on Android. */
    message?: string;
    /** The rows in Android's order, when it differs from iOS's. */
    rows?: readonly ActionMenuRow[];
    /** Draws Cancel as the dialog's first button, besides back and a tap outside. */
    cancelButton?: boolean;
    /** Draws only the first this many rows. */
    maxButtons?: number;
  };
}

const androidButton = (row: ActionMenuRow): AlertButton =>
  row.style
    ? { text: row.label, style: row.style, onPress: row.onPress }
    : { text: row.label, onPress: row.onPress };

export function showActionMenu(menu: ActionMenu): void {
  const { rows, cancelLabel = "Cancel" } = menu;
  if (Platform.OS === "ios") {
    const destructive = rows.flatMap((row, index) =>
      row.style === "destructive" ? [index] : [],
    );
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: menu.title,
        message: menu.message,
        options: [...rows.map((row) => row.label), cancelLabel],
        ...(destructive.length > 0
          ? {
              destructiveButtonIndex:
                destructive.length === 1 ? destructive[0] : destructive,
            }
          : {}),
        cancelButtonIndex: rows.length,
        ...(menu.userInterfaceStyle
          ? { userInterfaceStyle: menu.userInterfaceStyle }
          : {}),
      },
      (index) => rows[index]?.onPress(),
    );
    return;
  }
  const android = menu.android ?? {};
  const androidRows = (android.rows ?? rows).slice(0, android.maxButtons);
  Alert.alert(
    android.title ?? menu.title ?? "",
    android.message ?? menu.message,
    [
      ...(android.cancelButton
        ? [{ text: cancelLabel, style: "cancel" as const }]
        : []),
      ...androidRows.map(androidButton),
    ],
    { cancelable: true },
  );
}
