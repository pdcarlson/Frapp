import { Alert } from "react-native";

/**
 * Calendar's question for a repeating item, as the platform's own alert:
 * "This event only" / "All upcoming events" on an event (#3662), "This task
 * only" / "All upcoming tasks" on a copy of a repeating task (#5119), in the
 * words `@repo/validation` keeps for both apps (`SERIES_SCOPE_COPY`,
 * `TASK_SERIES_SCOPE_COPY`). Resolves `null` on Cancel or a dismiss.
 */
export function askSeriesScope(copy: {
  title: string;
  message: string;
  /** The one-item answer's label. */
  thisOne: string;
  /** The every-upcoming answer's label. */
  allUpcoming: string;
  /** Red answers, for a delete: both remove something. */
  destructive?: boolean;
  /** Only the every-upcoming answer red (an event's delete). */
  seriesDestructive?: boolean;
}): Promise<"instance" | "series" | null> {
  return new Promise((resolve) => {
    Alert.alert(
      copy.title,
      copy.message,
      [
        {
          text: copy.thisOne,
          style: copy.destructive ? "destructive" : "default",
          onPress: () => resolve("instance"),
        },
        {
          text: copy.allUpcoming,
          style:
            copy.destructive || copy.seriesDestructive
              ? "destructive"
              : "default",
          onPress: () => resolve("series"),
        },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}
