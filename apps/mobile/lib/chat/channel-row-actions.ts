import { Alert } from "react-native";
import {
  HIDE_CONVERSATION_LABEL,
  PIN_TO_TOP_LABEL,
  UNPIN_FROM_TOP_LABEL,
} from "@repo/hooks";

/**
 * What a long press on an s04 row offers (#2877): Pin to top or Unpin from top
 * on every row, and Hide conversation on a 1:1 DM (#2303), then Cancel.
 *
 * A native alert rather than a bottom sheet, the same as the hide
 * confirmation it leads to: at most three choices, which is what Android's
 * alert holds. The row's accessibility actions offer the same choices by name,
 * since a long press is not discoverable by a screen reader.
 */
export function openChannelRowActions({
  name,
  pinned,
  onTogglePin,
  onHide,
}: {
  /** The row's title, as the list shows it. */
  name: string;
  pinned: boolean;
  onTogglePin: () => void;
  /** Present only on a row that can be hidden (`canHideConversation`). */
  onHide?: () => void;
}): void {
  Alert.alert(name, undefined, [
    {
      text: pinned ? UNPIN_FROM_TOP_LABEL : PIN_TO_TOP_LABEL,
      onPress: onTogglePin,
    },
    ...(onHide ? [{ text: HIDE_CONVERSATION_LABEL, onPress: onHide }] : []),
    { text: "Cancel", style: "cancel" as const },
  ]);
}
