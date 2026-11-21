import { useQuery } from "@tanstack/react-query";
import { fetchOwnFormResponse, formResponseKey } from "@repo/chat-core/forms";
import { useFrappClient } from "@repo/hooks";

/**
 * The viewer's own answers to one form card (#3926 step 3), `null` before
 * they answer. One query key for the card and the form page
 * (`formResponseKey`), so a save the page writes into the cache turns the
 * card's Fill out into Edit your answers at once. `enabled` is off for a
 * card still in the outbox, which the server doesn't hold yet.
 */
export function useOwnFormResponse(
  messageId: string,
  enabled: boolean,
  /**
   * The form page reads again on every open, whatever the copy's age
   * (#4727); a read the card already has in flight is joined, not sent twice
   * (#4752).
   */
  readOnOpen = false,
) {
  const apiClient = useFrappClient();
  return useQuery({
    queryKey: formResponseKey(messageId),
    queryFn: () => fetchOwnFormResponse(apiClient, messageId),
    enabled,
    // The card asks once a minute at most; the page refetches when it opens.
    staleTime: 60_000,
    refetchOnMount: readOnOpen ? "always" : true,
  });
}
