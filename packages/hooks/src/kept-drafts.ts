"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClientScopeIfAny } from "./use-frapp-client";

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
 * - **The draft**, by form (`useKeptFormDraft`): the fields, owned and
 *   written by the form. Saving or an explicit discard (Cancel, Discard) drops
 *   it; going back, Escape or leaving the page keep it. While a save is in
 *   flight it is held out of the store, so a member who leaves and comes back
 *   before it lands can't send it twice.
 * - **The open panel**, by page (`useKeptPanel`): whether the page had its
 *   form open when it was left. Closing the form from inside the page forgets
 *   it, so only a page that was left with a form open reopens it on return,
 *   and only while that form still holds a draft.
 *
 * In memory, for the life of the tab: a draft can hold a picked file, which no
 * storage can keep, and a reload is a deliberate fresh start. Keys carry the
 * signed-in user and the chapter, so a draft never opens for another account
 * or in another chapter's form; the web provider also drops them all when
 * either changes.
 */
const drafts = new Map<string, unknown>();
const panels = new Map<string, unknown>();

function scoped(
  userId: string | null,
  chapterId: string | null,
  name: string,
): string {
  return `${userId ?? "anon"}\u0000${chapterId ?? "none"}\u0000${name}`;
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
 * The keys for one form and one page for the signed-in user in the active
 * chapter. `form` names the form and, for an edit, its record
 * (`event-edit:<id>`); `page` names the page (`events`).
 */
export function useKeptDraftKeys(): {
  draft: (form: string) => string;
  panel: (page: string) => string;
} {
  const { userId, chapterId } = useClientScopeIfAny();
  return useMemo(
    () => ({
      draft: (form: string) => scoped(userId, chapterId, `draft:${form}`),
      panel: (page: string) => scoped(userId, chapterId, `panel:${page}`),
    }),
    [userId, chapterId],
  );
}

/**
 * A form's side: what it opens on, and keeping what it holds.
 *
 * A form that stays mounted while closed calls `take()` where it fills its
 * fields on open: a kept draft comes back, or `undefined` for its usual fresh
 * or record values. A form that mounts on open reads `readKeptDraft` for its
 * first state instead and passes `restoredAtMount`. From the render those
 * values land on, what it first shows is the baseline, and the draft is kept
 * only once it differs from it (or when it opened on a kept one), so opening a
 * form and leaving it untouched keeps nothing. `rebase()` takes a new baseline
 * after the form fills itself later (a record that arrives after it opens).
 *
 * `hold()` when a save starts: the draft leaves the store, so the page coming
 * back mid-save doesn't offer the same form to send again. `release()` when
 * it fails puts it back; `drop()` when it lands. A form that stays open after
 * a save (the Members panel's invites) calls `rebase()` after `drop()`, so
 * what it is left showing isn't kept as a new draft.
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
    /** The form mounted on a kept draft it read itself. */
    restoredAtMount?: boolean;
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
  /** A save started: keep it out of the store until it lands or fails. */
  hold: () => void;
  /** The save failed: keep what the form holds again. */
  release: () => void;
} {
  const keys = useKeptDraftKeys();
  const key = form === null ? null : keys.draft(form);
  const [restored, setRestored] = useState(
    () => options?.restoredAtMount === true && key !== null,
  );
  // Bumped where the form fills itself; the next render's value, the one
  // that fill lands on, is the baseline. A count rather than a flag, so every
  // bump is a render even when the fill changed nothing.
  const [settles, setSettles] = useState(0);
  const settled = useRef(-1);
  const baseline = useRef<string | null>(null);
  const held = useRef(false);
  // What decides whether there is a draft, and what decides rewriting it: a
  // section opened after the last keystroke is kept, but isn't an edit.
  const whole = safeSignature(value);
  const signature = options?.signature ?? whole;
  const settle = useCallback(() => setSettles((count) => count + 1), []);

  const take = useCallback((): T | undefined => {
    settle();
    held.current = false;
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
    if (held.current) return;
    if (restoredRef.current || signature !== baseline.current) {
      writeKeptDraft(key, latest.current);
    } else {
      dropKeptDraft(key);
    }
  }, [open, key, settles, signature, whole]);

  const drop = useCallback(() => {
    held.current = false;
    if (key !== null) dropKeptDraft(key);
    setRestored(false);
  }, [key]);
  const discard = useCallback(() => {
    if (key !== null) dropKeptDraft(key);
    held.current = false;
    setRestored(false);
    settle();
  }, [key, settle]);
  const hold = useCallback(() => {
    held.current = true;
    if (key !== null) dropKeptDraft(key);
  }, [key]);
  // Written even after the form has gone: a save that fails once the member
  // has left keeps their work for when they come back.
  const release = useCallback(() => {
    held.current = false;
    if (key !== null) writeKeptDraft(key, latest.current);
  }, [key]);

  return useMemo(
    () => ({ take, restored, drop, discard, rebase: settle, hold, release }),
    [take, restored, drop, discard, settle, hold, release],
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
 * A page's side: reopen its form on return when the page was left with that
 * form open and the form still holds a draft (#4593). Closing the form from
 * inside the page forgets it, so the next visit is the page.
 *
 * `ready` holds the reopen until the page could open the form itself: the
 * member still may (a permission that loaded), and the subscription gate lets
 * the form open. Until then the "left open" mark stays.
 */
export function useKeptPanel({
  page,
  form,
  open,
  setOpen,
  ready = true,
}: {
  page: string;
  form: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  ready?: boolean;
}): void {
  const keys = useKeptDraftKeys();
  const panelKey = keys.panel(page);
  const draftKey = keys.draft(form);
  const [pending, setPending] = useState(
    () => readKeptPanel(panelKey) === true && hasKeptDraft(draftKey),
  );
  useEffect(() => {
    if (!pending || !ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reopen, once, the form the page was left with
    setPending(false);
    setOpen(true);
  }, [pending, ready, setOpen]);
  useEffect(() => {
    // Waiting to reopen: the mark is what says to.
    if (pending && !open) return;
    writeKeptPanel(panelKey, open ? true : null);
  }, [panelKey, open, pending]);
}
