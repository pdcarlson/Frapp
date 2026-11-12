import { useRouter } from "expo-router";
import { useAiSuggestions } from "@repo/hooks";
import { LAST_YEAR_COPY } from "@repo/validation";
import { ListRow, ListSection } from "@/components/list-section";
import { useAiSurfaces } from "@/lib/ai/availability";

/**
 * The Events tab's way to "This time last year" (#3930): one row, "2 events
 * from this time last year", only while some are waiting for this officer.
 * The server lists a suggestion only for someone who could act on it, so
 * everyone else, and every chapter with the server's AI off, sees nothing.
 *
 * It is the twin of the Tasks tab's row (`SuggestedTasksEntry`) and leads to
 * the same list, where events and tasks from last year sit together. It is
 * drawn last on the screen, so its arrival after the read moves nothing an
 * officer is looking at.
 */
export function SuggestedEventsEntry() {
  const router = useRouter();
  const available = useAiSurfaces().available === true;
  const suggestions = useAiSuggestions({ enabled: available });
  const count = (suggestions.data?.items ?? []).filter(
    (item) => item.kind === "event" && item.event != null,
  ).length;
  if (!available || count === 0) return null;
  return (
    <ListSection>
      <ListRow
        label={LAST_YEAR_COPY.waiting(count)}
        accessibilityHint="Opens what your chapter did around now last year."
        onPress={() => router.push("/suggested-tasks")}
      />
    </ListSection>
  );
}
