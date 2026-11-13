/**
 * One sheet at a time among the ones that open by themselves at launch:
 * What's new (`components/whats-new/whats-new-host.tsx`) and Meet Frapp AI
 * (`components/ai/meet-frapp-ai-host.tsx`). Each asks for its turn here, and
 * the second waits until the first is closed, so two sheets never stack over
 * the chat home on the same launch. Web has no need for it: its hosts stand
 * down when any dialog is already open.
 *
 * Module state, not React state: the hosts live in different parts of the
 * tree, and a turn is per process, like the hosts' own once-per-launch
 * checks.
 */

type Waiting = { name: string; open: () => void };

let active: string | null = null;
const queue: Waiting[] = [];

function next() {
  if (active !== null) return;
  const head = queue.shift();
  if (!head) return;
  active = head.name;
  head.open();
}

/**
 * Runs `open` now when no other startup sheet is up, or once the one that is
 * has been released. Returns a cancel for a host that unmounts first: it
 * drops a waiting request, and releases the turn if `open` already ran.
 */
export function requestStartupSheet(name: string, open: () => void): () => void {
  const entry: Waiting = { name, open };
  queue.push(entry);
  next();
  return () => {
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    else releaseStartupSheet(name);
  };
}

/** The sheet `name` has closed: the next one waiting may open. */
export function releaseStartupSheet(name: string): void {
  if (active !== name) return;
  active = null;
  next();
}

/** For tests: forget every turn. */
export function resetStartupSheetsForTests(): void {
  active = null;
  queue.length = 0;
}
