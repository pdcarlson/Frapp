import { useRouter } from "expo-router";
import { useAiSuggestions } from "@repo/hooks";
import { AI_SUGGESTION_COPY } from "@repo/validation";
import { ListRow, ListSection } from "@/components/list-section";
import { useAiSurfaces } from "@/lib/ai/availability";

/**
 * The task board's way to the suggested tasks (#4313): one row, "3 suggested
 * tasks", only while some are waiting for this member. The server lists a
 * suggestion only for someone who could accept it, so everyone else, and
 * every chapter with the server's AI off, sees nothing here.
 *
 * It sits under the board, last on the screen, so its arrival after the read
 * moves nothing a member is looking at. The push for a new batch opens the
 * list directly; this row is the way back to it.
 */
export function SuggestedTasksEntry() {
  const router = useRouter();
  const available = useAiSurfaces().available === true;
  const suggestions = useAiSuggestions({ enabled: available });
  const count = (suggestions.data?.items ?? []).filter(
    (item) => item.kind === "task" && item.task !== null,
  ).length;
  if (!available || count === 0) return null;
  return (
    <ListSection>
      <ListRow
        label={AI_SUGGESTION_COPY.waiting(count)}
        accessibilityHint="Opens the tasks suggested from your chapter's minutes."
        onPress={() => router.push("/suggested-tasks")}
      />
    </ListSection>
  );
}
