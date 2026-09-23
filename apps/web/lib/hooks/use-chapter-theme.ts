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
 *    client-side fallback to run. A row written before an engine change
 *    carries what that engine produced, keys and all, so this applies it:
 *    its fill or hover can sit under the §8 floor until the API's
 *    stale-palette sweep recomputes it (accent-engine.md §4, #1165).
 *  - A row missing any of those keys applies nothing, so whatever already
 *    paints stands: the palette the `(dashboard)` layout emitted from this
 *    browser's accent cache, if it holds one for the chapter, otherwise the
 *    default-seed (`#DDB844`) palette baked into `signet.css`. A row persisted
 *    before the Signet map existed is that case until the API's stale-palette
 *    sweep recomputes it (accent-engine.md §4, #1165), and so is a row
 *    inserted without a palette since the sweep's last tick; the gate also
 *    keeps a malformed row from applying half a palette. Nothing here assumes
 *    the keys exist.
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
 * already painted its default-seed (`#DDB844`) palette, and a cookie read by
 * the `(dashboard)` layout is what closes that window.
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
   * the cache inherits: a row missing the Signet keys (as a row persisted
   * before them does, until the #1165 sweep reaches it) applies none, and half a map is
   * worse than none — the stylesheet's
   * house defaults are internally consistent, one chapter's primary beside the
   * house ring is not.
   */
  const resolved = useMemo(() => {
    const raw = data as Record<string, unknown> | undefined;
    const palette = raw?.["theme_palette"] as
      | Record<string, string>
      | undefined;
    if (!palette || Object.keys(palette).length === 0) return null;
    if (!SIGNET_ROLE_KEYS.every((key) => typeof palette[key] === "string")) {
      return null;
    }
    /*
      The chapter id comes out of the **payload**, not the store.

      `GET /v1/chapters/current` returns the chapter, `id` included, so the
      response says which chapter its palette belongs to. That is the only
      honest answer to the question the cache writer has to ask, and taking it
      from anywhere else is how the guard below became a tautology once before:
      it compared `useTenantScope()`'s chapter to `activeChapterId`, and both
      are the same `useChapterStore` selector read in the same render, so it
      could never fire.
    */
    const chapterId = typeof raw?.["id"] === "string" ? (raw["id"] as string) : null;
    return {
      chapterId,
      tokens: signetAccentSemanticVars(palette as unknown as SignetPalette),
    };
  }, [data]);
  const tokens = resolved?.tokens ?? null;

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!tokens) return;
    const root = document.documentElement;

    for (const [token, value] of Object.entries(tokens)) {
      root.style.setProperty(token, value);
    }

    return () => {
      // Remove chapter-specific overrides when the chapter changes or unmounts.
      // `tokens` is complete or `null` — the all-or-nothing check is in the memo
      // above — so the cleanup can read the same value the effect wrote from,
      // rather than an accumulator recording which of them made it.
      for (const token of Object.keys(tokens)) {
        root.style.removeProperty(token);
      }
    };
  }, [tokens, activeChapterId]);

  /*
    Record the palette for the next cold load.

    The guard is one comparison rather than the `usePersistUnderScope` machinery
    the chat first-chunk cache needs, because the hazard that machinery exists
    for is narrower here. There, `["channels"]` carries no chapter in its key,
    so on the commit that publishes a new tenant the client still holds the old
    tenant's rows and a naive write would file them under the new key. Here the
    query key *is* `["chapters","current",chapterId]`, so today data for the
    outgoing chapter is unreachable the instant `activeChapterId` moves —
    TanStack has no entry for the new key yet and `data` is `undefined`.

    **"Today" is doing real work in that sentence, which is why the comparison
    is against the payload rather than the store.** One `placeholderData:
    keepPreviousData` on `useCurrentChapter` — the natural thing to reach for to
    smooth the switch itself — and `data` would keep the *outgoing* chapter's
    palette across the change while the scope names the incoming one. The row
    written then says chapter Y and holds chapter X's colours, the server serves
    it happily because the key matches, and the next cold load paints one
    chapter's brand inside another: a wrong answer that looks like a working
    cache, which is the failure this whole module is written against. Comparing
    the response's own `id` to the scope makes that a skipped write instead.

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
    if (!scope || !resolved?.tokens) return;
    // No `id` in the payload is not a licence to write: it means this response
    // cannot vouch for which chapter it describes.
    if (resolved.chapterId !== scope.chapterId) return;
    persistCachedAccent(scope, resolved.tokens, Date.now());
  }, [scope, resolved]);

  /*
    Disable the server-rendered cached accent while it names a different chapter.

    `chapter-accent-style.tsx` renders a `:root` rule that the live palette
    outranks, so for the chapter it was rendered for there is nothing to undo —
    the handover is pure cascade. A chapter *change* is different: the paths
    that change chapter without a document load leave that rule behind, and the
    apply effect above removes its inline properties on the way out. The old
    chapter's cached accent would then show through, which is the one thing this
    whole change exists to prevent, arriving from the fix rather than the bug.

    **Toggled, not removed, and both halves of that matter.**

    Not removed, because the element belongs to React. It is a plain host fiber
    under `(dashboard)/layout.tsx` — `ChapterAccentStyle` passes no `precedence`
    or `href`, so React 19 does not treat it as a hoistable resource and it
    keeps an ordinary `stateNode` pointing at it. `removeChild` on the React
    side is unguarded, so detaching the node here makes React throw
    `NotFoundError` the next time it unmounts or re-renders that subtree — a
    whole-dashboard error screen on the next sign-out or hard refresh. Setting
    `media` instead leaves the tree intact, and React never writes that property
    for this element because it is not among its props.

    Toggled, because the mismatch is not always a chapter change. On a cold
    load the two sides come from different clocks: the store rehydrates from
    `localStorage` synchronously, while the value the server rendered from is
    the token's `active_chapter_id` claim, which only reaches the store when
    `useClaimChapterSync` sees `INITIAL_SESSION`. A browser whose stored
    chapter is stale — switched on another device — therefore renders the
    *right* accent and would have had it destroyed one commit later by a
    disagreement the claim was about to settle, which is the original flash
    arriving by way of the fix. A toggle simply turns back on when the claim
    lands. `null` stays enabled: it means "not resolved yet".

    **No dependency array, because `activeChapterId` is only one of the two
    sides.** The other is the `data-chapter` attribute, which React rewrites on
    the same fiber whenever the layout re-renders server-side — `router.refresh()`
    from the onboarding wizard or `/join`, or any refresh once the token claim
    has caught up. Keyed on the chapter alone, the effect would not re-run on
    that commit: a rule disabled while it named the outgoing chapter would stay
    disabled after React had already corrected it to name the current one, and
    the cache would be silently off for the life of the document with nothing to
    show for it. Re-reading the attribute after every commit costs a
    `getElementById` and a string compare, and the write is idempotent.

    **A rule with no chapter attribute is nobody's, and stays off.** That is how
    a `null` store is told apart from a `null` store, which are two different
    situations wearing the same value. On a cold load it means "not resolved
    yet" — the browser's persisted chapter is empty and `useClaimChapterSync`
    has not yet written the token's claim — and the rule the server rendered is
    right, so it must keep painting. After an identity change it means the
    member is gone, and the outgoing member's chapter accent must not keep
    painting for whoever is here now. Nothing about the value distinguishes
    them; what does is that `clearCachedAccent` runs on the second and strips
    the attribute, so this effect sees a rule that claims no chapter at all.

    The uid is deliberately not consulted here. A `null` uid means "not resolved
    yet" too, and two members of the same chapter share an accent — so it has no
    bearing on this question, and the identity *event* is already handled where
    it is observed.
  */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const cached = document.getElementById(ACCENT_CACHE_STYLE_ID);
    if (!(cached instanceof HTMLStyleElement)) return;
    const renderedFor = cached.getAttribute(ACCENT_CACHE_CHAPTER_ATTR);
    const namesLiveChapter =
      renderedFor !== null &&
      (!activeChapterId || renderedFor === activeChapterId);
    // `not all` matches no medium, so the rule stops applying without the
    // stylesheet leaving the document.
    cached.media = namesLiveChapter ? "" : "not all";
  });
}
