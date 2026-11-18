import { useCallback } from "react";
import { useUpdateTaskStatus } from "@repo/hooks";
import { alertFailure } from "@/lib/failure-alert";

/**
 * Start: the assignee's To do → In progress (`PATCH /v1/tasks/:id/status`),
 * as chat's task card offers it (#5492: the task screen and the long-press
 * menu offer it too, since an Activity row now opens the screen, not the
 * card). The status hook's own write, so the board and the screen update
 * as the card's Start updates them; a refusal is the platform's alert, since
 * neither the menu nor More has a line to carry it.
 */
export function useStartTask(): (taskId: string) => void {
  const { mutateAsync } = useUpdateTaskStatus();
  return useCallback(
    (taskId: string) => {
      const send = () => {
        mutateAsync({ id: taskId, body: { status: "IN_PROGRESS" } }).catch(
          (error: unknown) =>
            alertFailure({
              title: "Couldn't start the task",
              error,
              retry: send,
            }),
        );
      };
      send();
    },
    [mutateAsync],
  );
}
