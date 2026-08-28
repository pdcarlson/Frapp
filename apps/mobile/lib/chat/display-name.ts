/**
 * Display helpers for the chat surface: avatar initials and the s05 author
 * label.
 *
 * Lives in `lib/` rather than beside the components that use it for the reason
 * `lib/chat/channel-list.ts` documents — expo-router discovers routes with
 * `requireContext` over the whole `app/` tree, so a `*.spec.*` placed next to a
 * screen is bundled into the app and drags `vitest` into the Metro graph. That
 * breaks `expo export` while lint, types, and the test run all stay green.
 * A pure helper in `lib/` can carry a spec safely.
 *
 * The name resolution AND the author label are shared with web in `@repo/hooks`
 * (`packages/hooks/src/display-names.ts` — `resolveAuthorName`,
 * `resolveAuthorLabel`, `authorInitialsFallback`); this module is now only the
 * mobile-specific initials rule, which deliberately differs from web's.
 *
 * `senderLabel` used to live here. It was deleted rather than kept as a wrapper
 * when `sender_id` became nullable: its `senderId.slice(0, 6)` fallback threw on
 * an imported message, and the fix belongs in one place both platforms read.
 */

/**
 * Two-letter initials for an avatar, matching the drawn `MR`.
 *
 * `spec/ui/design-system/components.md` specifies the incoming message avatar as
 * initials, not an image, so this is the whole avatar — there is no photo
 * variant to fall back from.
 *
 * Deliberately *not* unified with web's `initials()` (`apps/web/lib/utils.ts`),
 * which yields one letter for a single-word name where this yields two. The
 * reason is consumer blast radius, not a designed difference: web's helper backs
 * three non-chat surfaces whose avatars would visibly change, while this one has
 * only chat callers. Note the divergence is newly *visible* — a one-word name now
 * draws `P` on web and `PR` on mobile for the same sender.
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
}
