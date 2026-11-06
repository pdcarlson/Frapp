/**
 * New task opens from the tab bar's quick actions, over whatever screen the
 * officer is on, so the confirmation that a task went to someone else has to
 * reach the Tasks screen from outside it. A task assigned to someone else never
 * appears on the officer's own board, so without the notice a create would
 * read as a failed one.
 */
type Listener = (assigneeName: string | null, wasSelf: boolean) => void;

const listeners = new Set<Listener>();

export function onTaskCreated(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceTaskCreated(
  assigneeName: string | null,
  wasSelf: boolean,
): void {
  for (const listener of listeners) listener(assigneeName, wasSelf);
}
