"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveChapterIdIfAny } from "./use-frapp-client";

/**
 * Form drafts kept when a member leaves a form without saving it (Paul,
 * 2026-11-13, #4593: "keep the draft", not an "are you sure" prompt).
 *
 * A form that a page owns opens in place of that page, beside chat, so a nav
 * link or a channel click takes the member off the page with the form still
 * open. Before this, what they had typed went with the page. Now the form
 * reports what it holds here, and opening it again brings it back, the way
 * Gmail keeps a compose window and the chat's + card keeps each form's draft
 * per channel (`use-plus-drafts.ts`, #3983).
 *
 * Two things are kept, apart:
 *
 * - **The draft**, by form (`keptDraftKey`): the fields, owned and written by
 *   the form. Saving or an explicit discard (Cancel, Discard) drops it; going
 *   back, Escape or leaving the page keep it.
 * - **The open panel**, by page (`keptPanelKey`): which form the page had open
 *   when it was left, written by the page. Closing the form from inside the
 *   page forgets it, so only a page that was left with a form open reopens it
 *   on return, and only while that form still holds a draft.
 *
 * In memory, for the life of the tab: a draft can hold a picked file, which no
 * storage can keep, and a reload is a deliberate fresh start. Keys carry the
 * chapter, so a draft never opens in another chapter's form; the web provider
 * also drops them all when the signed-in user or the chapter changes.
 */
const drafts = new Map<string, unknown>();
const panels = new Map<string, unknown>();

function scoped(chapterId: string | null, name: string): string {
  return `${chapterId ?? "none"}\u0000${name}`;
}

/** What a form left, or `undefined` for a fresh one. */
export function readKeptDraft<T>(key: string): T | undefined {
  return drafts.get(key) as T | undefined;
}

/** The form's own edit; `null` when nothing is left worth keeping. */
export function writeKeptDraft(key: string, value: unknown): void {
  if (value === null || value === undefined) drafts.delete(key);
  else drafts.set(key, value);
}

export function hasKeptDraft(key: string): boolean {
  return drafts.has(key);
}

/** Saved, or discarded. */
export function dropKeptDraft(key: string): void {
  drafts.delete(key);
}

export function readKeptPanel<T>(key: string): T | undefined {
  return panels.get(key) as T | undefined;
}

/** The form a page has open, or `null` once it closes from inside the page. */
export function writeKeptPanel(key: string, value: unknown): void {
  if (value === null || value === undefined) panels.delete(key);
  else panels.set(key, value);
}

/** Sign-out, another account, another chapter. Also the test seam. */
export function dropAllKeptDrafts(): void {
  drafts.clear();
  panels.clear();
}

/**
 * The keys for one form and one page in the active chapter. `form` names the
 * form and, for an edit, its record (`event-edit:<id>`); `page` names the
 * page (`events`).
 */
export function useKeptDraftKeys(): {
  draft: (form: string) => string;
  panel: (page: string) => string;
} {
  const chapterId = useActiveChapterIdIfAny();
  return useMemo(
    () => ({
      draft: (form: string) => scoped(chapterId, `draft:${form}`),
      panel: (page: string) => scoped(chapterId, `panel:${page}`),
    }),
    [chapterId],
  );
}

/**
 * A form's side: what it opens on, and keeping what it holds.
 *
 * The form calls `take()` where it fills its fields on open: a kept draft
 * comes back, or `undefined` for its usual fresh or record values. From the
 * render those values land on, what it first shows is the baseline, and the
 * draft is kept only once it differs from it (or when it opened on a kept
 * one), so opening a form and leaving it untouched keeps nothing. `rebase()`
 * takes a new baseline after the form fills itself later (a record that
 * arrives after the form opens).
 *
 * `form` is `null` for a use that keeps nothing (the same form opened from
 * chat, which keeps its own drafts per channel).
 */
export function useKeptFormDraft<T>(
  form: string | null,
  open: boolean,
  value: T,
  options?: {
    /** What decides "changed", for a value `JSON.stringify` can't see (a file). */
    signature?: string;
  },
): {
  /** The kept draft to open on, if there is one. Call it where the form fills on open. */
  take: () => T | undefined;
  /** The form opened on a kept draft, and it hasn't been discarded. */
  restored: boolean;
  /** Saved: nothing left to keep. */
  drop: () => void;
  /** Discard: drop it and open fresh; the form refills itself. */
  discard: () => void;
  /** The form filled itself after opening; that is not an edit. */
  rebase: () => void;
} {
  const keys = useKeptDraftKeys();
  const key = form === null ? null : keys.draft(form);
  const [restored, setRestored] = useState(false);
  // Bumped where the form fills itself; the next render's value, the one
  // that fill lands on, is the baseline. A count rather than a flag, so every
  // bump is a render even when the fill changed nothing.
  const [settles, setSettles] = useState(0);
  const settled = useRef(-1);
  const baseline = useRef<string | null>(null);
  // What decides whether there is a draft, and what decides rewriting it: a
  // section opened after the last keystroke is kept, but isn't an edit.
  const whole = safeSignature(value);
  const signature = options?.signature ?? whole;
  const settle = useCallback(() => setSettles((count) => count + 1), []);

  const take = useCallback((): T | undefined => {
    settle();
    if (key === null) {
      setRestored(false);
      return undefined;
    }
    const kept = readKeptDraft<T>(key);
    setRestored(kept !== undefined);
    return kept;
  }, [key, settle]);

  const latest = useRef(value);
  const restoredRef = useRef(restored);
  useEffect(() => {
    latest.current = value;
    restoredRef.current = restored;
  });

  // The key the open form is writing under. On the render a form opens (or
  // turns into another form) its state is still what the last one held,
  // until its fill lands; writing that would put a stale draft back.
  const writingTo = useRef<string | null>(null);
  useEffect(() => {
    if (!open || key === null) {
      writingTo.current = null;
      return;
    }
    if (writingTo.current !== key || settled.current !== settles) {
      writingTo.current = key;
      settled.current = settles;
      baseline.current = signature;
      return;
    }
    if (restoredRef.current || signature !== baseline.current) {
      writeKeptDraft(key, latest.current);
    } else {
      dropKeptDraft(key);
    }
  }, [open, key, settles, signature, whole]);

  const drop = useCallback(() => {
    if (key !== null) dropKeptDraft(key);
    setRestored(false);
  }, [key]);
  const discard = useCallback(() => {
    if (key !== null) dropKeptDraft(key);
    setRestored(false);
    settle();
  }, [key, settle]);

  return useMemo(
    () => ({ take, restored, drop, discard, rebase: settle }),
    [take, restored, drop, discard, settle],
  );
}

function safeSignature(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * A page's open-or-closed state for one form panel, kept for the page's next
 * visit (#4593): it starts open when the page was left with that panel open
 * and the form still holds a draft, and closed otherwise. Closing the panel
 * from inside the page forgets it.
 */
export function useKeptPanelOpen(
  page: string,
  form: string,
): [boolean, (open: boolean) => void] {
  const keys = useKeptDraftKeys();
  const panelKey = keys.panel(page);
  const [open, setOpen] = useState(
    () =>
      readKeptPanel(panelKey) === true && hasKeptDraft(keys.draft(form)),
  );
  useEffect(() => {
    writeKeptPanel(panelKey, open ? true : null);
  }, [panelKey, open]);
  return [open, setOpen];
}
