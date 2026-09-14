"use client";

import { useEffect, useMemo } from "react";
import { useCurrentChapter } from "@repo/hooks";
// The `/accent-vars` subpath, not the package root: the root barrel pulls in
// the accent generator and `colorjs.io`, which are server-side concerns
// (accent-engine.md §1) and have no business in a browser bundle that only
// re-keys an already-generated palette.
import {
  signetAccentSemanticVars,
  type SignetPalette,
} from "@repo/chapter-theme/accent-vars";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useTenantScope } from "@/lib/tenancy/scope";
import {
  ACCENT_CACHE_CHAPTER_ATTR,
  ACCENT_CACHE_STYLE_ID,
  persistCachedAccent,
} from "@/lib/theme/accent-cache";

/**
 * Applies the active chapter's accent to the shell.
 *
 * This used to iterate every key of `chapters.theme_palette` onto `:root`,
 * which is how the legacy bone-validated `--ring` inline-overrode the `.dark`
 * stylesheet values (#1149) and why the sidebar's branded surface fought its
 * own text ladder (#1150/#1164). Since the #920 shell cutover it is a
 * deliberate mapping instead — the stored map is data, not a stylesheet:
 *
 *  - The persisted `--signet-accent-*` roles are remapped onto the semantic
 *    names the Signet stylesheet defines (`--primary`, `--ring`,
 *    `--accent-subtle`, …) via `signetAccentSemanticVars`. Contrast is
 *    guaranteed by the engine at generation time
 *    (`spec/ui/design-system/accent-engine.md` §8) — there is no per-token
 *    client-side fallback to run.
 *  - A row persisted before the Signet map existed simply lacks those keys;
 *    the house-gold defaults baked into `signet.css` stand until a save or
 *    recompute refreshes the row (accent-engine.md §3, staleness tracked in
 *    #1165). Nothing here assumes the keys exist.
 *  - **No legacy token is applied at all**, which is why this is an allow-list
 *    rather than the blind key iteration it used to be. `derivePalette` was
 *    deleted at the slice-9 cutover so nothing writes its map any more, but
 *    rows saved before then still *hold* it, and six of its eight tokens were
 *    composited over or validated against bone — `--mention-bg` is the accent
 *    at 12% *over bone*, `--chat-self-bubble` at 8% over bone,
 *    `--reaction-active`, `--mention-fg`, `--ring` and `--brand-band` all
 *    measured against it. Carrying any of them onto a `#0E0D0B` surface paints
 *    a near-white fill on the dark feed, so a stale row must not be able to
 *    reach `:root` through here. (The other two, `--side-bg` and
 *    `--side-accent`, were dark-context tokens for the branded sidebar the
 *    Signet shell replaced outright.) The chat renderers that read those three
 *    take `--accent-subtle` / the accent badge recipe instead. That is also why
 *    `--ring` is the engine's: nothing bone-validated writes to this element
 *    any more (#1149).
 *
 * Mounted once by `DashboardShell`, so branding applies shell-wide (it used
 * to mount under the chat route only, which repainted the sidebar depending
 * on where you stood).
 *
 * ## It is also the cache's writer
 *
 * The palette this hook resolves is the only complete, current one the client
 * ever holds, so it is the only honest place to record it for the next cold
 * load. `lib/theme/accent-cache.ts` explains what that record is for — the
 * short version is that everything above happens *after* `signet.css` has
 * already painted house gold, and a cookie read by the `(dashboard)` layout is
 * what closes that window.
 *
 * Writing here also means the cache has no invalidation of its own to get
 * wrong. `useUpdateChapter` invalidates `["chapters","current",chapterId]` on
 * a successful accent save (`packages/hooks/src/use-chapters.ts`), this hook
 * observes that key, so a saved accent refreshes the cookie by the same path
 * that repaints the shell. There is no second code path to keep in step, and
 * no save that can repaint the live surface without also correcting the row.
 */

/** The engine roles `signetAccentSemanticVars` reads; all-or-nothing. */
const SIGNET_ROLE_KEYS = [
  "--signet-accent-primary",
  "--signet-accent-hover",
  "--signet-accent-ring",
  "--signet-accent-subtle-bg",
  "--signet-accent-border",
  "--signet-accent-text",
  "--signet-accent-on-primary",
] as const;

export function useChapterTheme() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data } = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });
  const scope = useTenantScope();

  /**
   * The semantic tokens for the current chapter, or `null`.
   *
   * All-or-nothing, which is the rule this hook has always applied and which
   * the cache inherits: a row persisted before the Signet keys existed (#1165)
   * simply lacks them, and half a map is worse than none — the stylesheet's
   * house defaults are internally consistent, one chapter's primary beside the
   * house ring is not.
   */
  const tokens = useMemo(() => {
    const raw = data as Record<string, unknown> | undefined;
    const palette = raw?.["theme_palette"] as
      | Record<string, string>
      | undefined;
    if (!palette || Object.keys(palette).length === 0) return null;
    if (!SIGNET_ROLE_KEYS.every((key) => typeof palette[key] === "string")) {
      return null;
    }
    return signetAccentSemanticVars(palette as unknown as SignetPalette);
  }, [data]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!tokens) return;
    const root = document.documentElement;

    const applied: string[] = [];
    for (const [token, value] of Object.entries(tokens)) {
      root.style.setProperty(token, value);
      applied.push(token);
    }

    return () => {
      // Remove chapter-specific overrides when the chapter changes or unmounts
      for (const token of applied) {
        root.style.removeProperty(token);
      }
    };
  }, [tokens, activeChapterId]);

  /*
    Record the palette for the next cold load.

    The guard is one comparison rather than the `usePersistUnderScope` machinery
    the chat first-chunk cache needs, because the hazard that machinery exists
    for cannot arise here. There, `["channels"]` carries no chapter in its key,
    so on the commit that publishes a new tenant the client still holds the old
    tenant's rows and a naive write would file them under the new key. Here the
    query key *is* `["chapters","current",chapterId]`, so data for the outgoing
    chapter is unreachable the instant `activeChapterId` moves — TanStack has no
    entry for the new key yet and `data` is `undefined`.

    What remains is the auth uid moving under a stable chapter id: a same-tab
    account swap between two members of the same chapter. That writes the new
    member's uid against a palette fetched for the old one — and it is the same
    chapter, so it is the same palette. Harmless, and stated rather than
    guarded, because a guard would have to be able to tell it from the ordinary
    first resolve.

    `scope` is `null` until the Supabase session resolves, so the first write of
    a cold load lands a moment after the paint it is for. That is the point: it
    is caching for the *next* load, never for this one.
  */
  useEffect(() => {
    if (!scope || !tokens) return;
    if (scope.chapterId !== activeChapterId) return;
    persistCachedAccent(scope, tokens, Date.now());
  }, [scope, tokens, activeChapterId]);

  /*
    Retire the server-rendered cached accent once it names a different chapter.

    `chapter-accent-style.tsx` renders a `:root` rule that the live palette
    outranks, so for the chapter it was rendered for there is nothing to undo —
    the handover is pure cascade. A chapter *change* is different. The two paths
    that change chapter without a document load — `/join` and the onboarding
    wizard, which switch in place — leave that rule behind, and the effect above
    removes its inline properties on the way out. The old chapter's cached
    accent would then show through, which is the one thing this whole change
    exists to prevent, arriving from the fix rather than from the bug.

    Removing rather than rewriting: only one chapter is cached at a time
    (`accent-cache.ts` § One scope), so there is nothing to put in its place,
    and the house default is the honest answer until the new chapter's palette
    arrives.

    Keyed on `activeChapterId` alone. A `null` uid means "not resolved yet",
    never "different member", and two members of the same chapter share an
    accent anyway — so the uid has no bearing on this question.
  */
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!activeChapterId) return;
    const cached = document.getElementById(ACCENT_CACHE_STYLE_ID);
    if (!cached) return;
    if (cached.getAttribute(ACCENT_CACHE_CHAPTER_ATTR) === activeChapterId) {
      return;
    }
    cached.remove();
  }, [activeChapterId]);
}
