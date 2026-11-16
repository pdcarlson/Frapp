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
 * The specs differ on purpose in who is viewing (a wildcard, a fixed set, a
 * set a test swaps), in the org config, and in which mutations they observe,
 * so those are options and `overrides`; everything else is the one baseline
 * every page spec renders against: a server with AI off (no AI row, #4308),
 * loaded empty reads, and idle mutations.
 */
export type SettingsHooksOptions = {
  /** What `useCurrentChapter()` returns. */
  currentChapter: () => unknown;
  /** The viewer's permission set, read on every render. */
  permissions: () => string[];
  /** `useOrgConfig().data`, read on every render. Defaults to an IFC chapter. */
  orgConfig?: () => Record<string, unknown>;
  /** Replaces or adds `@repo/hooks` exports, such as an observed mutation. */
  overrides?: Record<string, unknown>;
};

const idleMutation = () => ({ mutateAsync: vi.fn(), isPending: false });
const loadedEmpty = () => ({ data: [], isPending: false, isError: false });

/** The `@repo/hooks` module the Settings page reads. */
export function settingsHooks({
  currentChapter,
  permissions,
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
 * `@/components/shared/can` as a pass-through. The permission gate has its own
 * tests; in a page spec it must not swallow the controls.
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
