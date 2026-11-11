"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { PlusMenuCommand } from "@repo/chat-core/plus-menu";

const keyOf = (channelId: string, command: PlusMenuCommand) =>
  `${channelId}\u0000${command}`;

/**
 * The + card's drafts (#3983): one per form per channel, kept when the card
 * closes (a click away, Escape, the X, a channel switch) and dropped only
 * when the form posts or the member discards it. Clicking away never loses
 * what was typed.
 *
 * A form owns its fields while it is open and reports each edit here; the
 * values sit in a ref, so typing doesn't re-render the chat. Only whether a
 * form has a draft is state, for the menu's Draft mark.
 */
export function usePlusDrafts() {
  const drafts = useRef(new Map<string, unknown>());
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => new Set());
  // Bumped when a draft is replaced or dropped, so the open form remounts on
  // it rather than keep showing what it held.
  const [versions, setVersions] = useState<Readonly<Record<string, number>>>(
    {},
  );

  const mark = useCallback((key: string, on: boolean) => {
    setMarked((previous) => {
      if (previous.has(key) === on) return previous;
      const next = new Set(previous);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const bump = useCallback((key: string) => {
    setVersions((previous) => ({ ...previous, [key]: (previous[key] ?? 0) + 1 }));
  }, []);

  /** What the form opens on, or `undefined` for a blank one. */
  const get = useCallback(
    <T>(channelId: string, command: PlusMenuCommand): T | undefined =>
      drafts.current.get(keyOf(channelId, command)) as T | undefined,
    [],
  );
  /** A form's own edit. */
  const save = useCallback(
    (channelId: string, command: PlusMenuCommand, draft: unknown) => {
      const key = keyOf(channelId, command);
      drafts.current.set(key, draft);
      mark(key, true);
    },
    [mark],
  );
  /** A typed command's details, replacing whatever the form held. */
  const seed = useCallback(
    (channelId: string, command: PlusMenuCommand, draft: unknown) => {
      const key = keyOf(channelId, command);
      drafts.current.set(key, draft);
      mark(key, true);
      bump(key);
    },
    [bump, mark],
  );
  /** Posted or discarded. */
  const drop = useCallback(
    (channelId: string, command: PlusMenuCommand) => {
      const key = keyOf(channelId, command);
      drafts.current.delete(key);
      mark(key, false);
      bump(key);
    },
    [bump, mark],
  );
  const version = useCallback(
    (channelId: string, command: PlusMenuCommand) =>
      versions[keyOf(channelId, command)] ?? 0,
    [versions],
  );
  const markedFor = useCallback(
    (channelId: string | null): ReadonlySet<PlusMenuCommand> => {
      const out = new Set<PlusMenuCommand>();
      if (!channelId) return out;
      const prefix = `${channelId}\u0000`;
      for (const key of marked) {
        if (key.startsWith(prefix)) {
          out.add(key.slice(prefix.length) as PlusMenuCommand);
        }
      }
      return out;
    },
    [marked],
  );

  return useMemo(
    () => ({ get, save, seed, drop, version, markedFor }),
    [get, save, seed, drop, version, markedFor],
  );
}
