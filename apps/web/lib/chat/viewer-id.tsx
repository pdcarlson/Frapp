"use client";

/**
 * The `users.id` chat **paints** with: live if `GET /v1/users/me` has answered,
 * otherwise the one cached beside the first chunk for this same scope.
 *
 * ## Why this is not `useFrappUser`
 *
 * `useFrappUser` (`lib/auth/use-frapp-user.ts`) is the app-wide answer and stays
 * exactly as it is. It is read by `member-detail-sheet`, `service-page`,
 * `dashboard-notification-drawer` and `chapter-presence-provider` — ordinary
 * dashboard surfaces, none of them on the chat chunk. Teaching it about the
 * cache would pull Dexie onto every route that renders one of those, which is
 * the regression `first-chunk-wipe.ts` exists to avoid and
 * `performance-budgets.md` § Bundle size measures. The library costs two orders
 * more than the cache it would be serving.
 *
 * So the fallback lives here, in the chat chunk, where Dexie already is.
 *
 * ## Why the context carries the cached half only
 *
 * The obvious shape is a context holding the *resolved* id, published by
 * `ChatProvider`. It has a failure mode worth designing out: a consumer rendered
 * outside the provider would read the default and see `null` — and would then
 * have lost the **live** id too, which it used to get for free. A gate that
 * fails to a permanent skeleton is the thing #2249 exists to remove, so it
 * should not be reachable by putting a component in the wrong place.
 *
 * Carrying only the cached half makes the default harmless. Absent a provider
 * the context is `null`, {@link useChatViewerId} returns the live value, and the
 * surface behaves exactly as it did before this change — never worse. The
 * layering rule itself then has one home rather than one per caller.
 *
 * ## Why `live ?? cached` and not the other way round
 *
 * The cached id is this member's — the key it is read under is the Supabase auth
 * uid of the session in hand — but it is a round trip old, and the one way it
 * can be wrong without the key changing is an account deleted and recreated
 * under that same uid. A resolved live value settles that in every case, so it
 * wins whenever it exists. The cache is what fills the window before it, which
 * on a warm load is the whole of the wait and offline is unbounded: only
 * mutations are configured `networkMode: "always"`, so `["user","me"]` is not
 * attempted at all while the browser is offline and `isPending` never clears.
 *
 * What this deliberately does **not** do is treat "unknown" as "not mine". With
 * no live value and nothing cached this returns `null`, and `null` still means
 * *withhold* — `message-timeline.tsx`'s gate and the non-nullable
 * `MessageItemProps.viewerId` that #2255 introduced are untouched.
 */

import { createContext, useContext } from "react";
import { useViewerUserId } from "@repo/hooks";

/**
 * The cached `users.id` for the scope currently in effect, or `null`.
 *
 * Published by `ChatProvider`, which reads it off the same Dexie transaction as
 * the first-chunk rows and disowns it the moment the scope changes
 * (`use-first-chunk-cache.ts`).
 */
const CachedViewerIdContext = createContext<string | null>(null);

export function CachedViewerIdProvider({
  value,
  children,
}: {
  value: string | null;
  children: React.ReactNode;
}) {
  return (
    <CachedViewerIdContext.Provider value={value}>
      {children}
    </CachedViewerIdContext.Provider>
  );
}

/**
 * The viewer's `users.id` for painting, or `null` while it is genuinely unknown.
 *
 * `null` is not "somebody else" and must never be read as one — see
 * `message-timeline.tsx`'s gate and `message-item.tsx`'s non-nullable
 * `viewerId` for what a caller is expected to do with it.
 *
 * **Paint only.** Do not reach for this to attribute a send, a reaction or a
 * presence broadcast: those take the live id, and `use-first-chunk-cache.ts`
 * records why the line is drawn there.
 */
export function useChatViewerId(): string | null {
  const live = useViewerUserId();
  const cached = useContext(CachedViewerIdContext);
  return live ?? cached;
}
