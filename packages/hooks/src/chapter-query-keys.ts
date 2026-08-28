/**
 * Chapter-scoped TanStack Query key factory.
 *
 * `taskKeys` in `use-tasks.ts` is the model: a prefix, then the chapter id,
 * then a `"list"` / `"detail"` discriminator so a prefix match can mean "every
 * list" without also matching every detail. This helper is that shape as a
 * function, with one load-bearing constraint the ad-hoc factories still miss:
 *
 * **`chapterId` is a required `string`.** Omitting it, or passing `null` /
 * `undefined`, is a type error. Unscoped keys (`["polls"]`, `["tasks", id]`)
 * are how a chapter switch serves the outgoing chapter's rows. Web and mobile
 * both paper over that with a wholesale `queryClient.clear()` on switch (#1042
 * added mobile's), but that is defense in depth and not a substitute: the next
 * unscoped key is still a bug, and anything cached *within* a chapter's session
 * is untouched by it. Wave 1 migrates call sites onto this factory; this module
 * only exists so a key missing the tenant scope cannot type-check.
 *
 * Do not add `string | null` back. A hook that has no chapter yet should not
 * build a key; it should leave the query `enabled: false`.
 */
export function createChapterQueryKeys<const TScope extends string>(
  scope: TScope,
) {
  return {
    /** Prefix for every entry in this family, across chapters. */
    all: [scope] as const,
    /** Everything cached for one chapter. */
    chapter: (chapterId: string) => [scope, chapterId] as const,
    /** Prefix for every list in this chapter (invalidate here, don't fetch). */
    lists: (chapterId: string) => [scope, chapterId, "list"] as const,
    /**
     * Concrete list key. Always includes the filters slot — even `undefined`
     * — so it is not the same tuple as `lists(chapterId)`. Mount queries on
     * `list`; invalidate with `lists`.
     */
    list: (chapterId: string, filters?: unknown) =>
      [scope, chapterId, "list", filters] as const,
    details: (chapterId: string) => [scope, chapterId, "detail"] as const,
    detail: (chapterId: string, id: string) =>
      [scope, chapterId, "detail", id] as const,
  };
}

export type ChapterQueryKeys<TScope extends string> = ReturnType<
  typeof createChapterQueryKeys<TScope>
>;
