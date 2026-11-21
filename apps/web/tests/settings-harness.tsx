import type { ReactNode } from "react";
import { vi } from "vitest";

/**
 * Module stubs for the specs that render the whole Settings page
 * (`components/settings/settings-page.tsx`).
 *
 * `vi.mock` is hoisted per file and cannot be shared, so each spec still
 * declares its own mocks. What is shared is each factory's body, called from
 * inside the hoisted factory:
 *
 * ```tsx
 * vi.mock("@repo/hooks", async () =>
 *   (await import("@/tests/settings-harness")).settingsHooks({
 *     currentChapter: () => mockCurrentChapter(),
 *     permissions: () => ["*"],
 *   }),
 * );
 * ```
 *
 * Every page spec starts from one baseline: a server with AI off (no AI row,
 * #4308), an IFC chapter, loaded empty reads, and idle mutations. Who is
 * viewing and the org config are options, and a spec replaces through
 * `overrides` any export it needs to vary: `settings-module-deeplink` swaps
 * the AI reads to put the AI tab in reach, and `settings-rail-access` swaps
 * AI availability and the permissions read's loading and error states.
 */
export type SettingsHooksOptions = {
  /** What `useCurrentChapter()` returns. */
  currentChapter: () => unknown;
  /**
   * The viewer's permission set, read on every render, as a loaded
   * `useMyPermissions()`. Omit it only when `overrides.useMyPermissions`
   * supplies the whole read (one that can still be in flight, or fail);
   * without either, the viewer holds nothing.
   */
  permissions?: () => string[];
  /** `useOrgConfig().data`, read on every render. Defaults to an IFC chapter. */
  orgConfig?: () => Record<string, unknown>;
  /** Replaces or adds `@repo/hooks` exports, such as an observed mutation. */
  overrides?: Record<string, unknown>;
};

/** A mutation nobody has fired. */
export const idleMutation = () => ({ mutateAsync: vi.fn(), isPending: false });
/** A list read that loaded and found nothing. */
export const loadedEmpty = () => ({
  data: [],
  isPending: false,
  isError: false,
});

/**
 * The `@repo/hooks` exports the Settings page reads on its default tabs. A tab
 * with reads of its own (the roles, classes and groups tabs read
 * `useMembers`, `useRoleTiers`, `useInvitableRoleIds` and more) is not in the
 * baseline: a spec that opens one adds what it reads through `overrides`.
 */
export function settingsHooks({
  currentChapter,
  permissions = () => [],
  orgConfig = () => ({ org_archetype: "ifc" }),
  overrides = {},
}: SettingsHooksOptions): Record<string, unknown> {
  return {
    // A server with AI off: no AI row (#4308).
    useAiConsent: () => ({ data: null }),
    aiAvailableFrom: () => false,
    isFirstAiReadInFlight: () => false,
    useCurrentChapter: () => currentChapter(),
    useMyPermissions: () => ({
      data: { permissions: permissions() },
      isPending: false,
      isError: false,
    }),
    usePermissionsCatalog: loadedEmpty,
    useSemesters: loadedEmpty,
    useSemesterRollover: idleMutation,
    useUploadChapterLogo: idleMutation,
    useRemoveChapterLogo: idleMutation,
    useUpdateChapter: idleMutation,
    useCreatePortal: idleMutation,
    useChannels: () => ({ data: [] }),
    useOrgConfig: () => ({
      data: orgConfig(),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    }),
    usePatchOrgConfig: idleMutation,
    usePendingConfigKeys: () => new Set<string>(),
    useRoles: loadedEmpty,
    ...overrides,
  };
}

/** `@/lib/stores/chapter-store`, with the active chapter read on every render. */
export function chapterStore(
  activeChapterId: () => string | null = () => "chap-1",
) {
  return {
    useChapterStore: (
      selector: (s: { activeChapterId: string | null }) => unknown,
    ) => selector({ activeChapterId: activeChapterId() }),
  };
}

/** `next/navigation`, with the query string read on every render. */
export function navigation(
  searchParams: () => URLSearchParams = () => new URLSearchParams(),
) {
  return { useSearchParams: () => searchParams() };
}

/**
 * `@/components/shared/can` as a pass-through, for a page spec that tests
 * what the page renders rather than what `Can` hides: the gate has its own
 * tests. A spec that tests the gating itself mocks `Can` by hand instead, as
 * `settings-rollover-promotion` does to hide the promote toggle from a
 * viewer without `roles:manage`.
 */
export function canPassThrough() {
  return {
    Can: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
}

/** `@/lib/hooks/use-toast`; pass `toast` to observe it. */
export function toastStub(toast?: (...args: unknown[]) => unknown) {
  return { useToast: () => ({ toast: toast ?? vi.fn() }) };
}
