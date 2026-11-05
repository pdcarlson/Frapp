/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reads, enabledCalls, mutate } = vi.hoisted(() => ({
  reads: {
    permissions: ["*"] as string[] | undefined,
    modules: {} as Record<string, boolean> | undefined,
    dismissed: [] as string[],
    members: [{}, {}] as unknown[],
    events: [] as unknown[],
    zones: [] as unknown[],
    documents: [] as unknown[],
    invoices: [] as unknown[],
  },
  enabledCalls: {} as Record<string, boolean | undefined>,
  mutate: vi.fn(),
}));

vi.mock("./use-frapp-client", () => ({ useActiveChapterId: () => "ch-1" }));
vi.mock("./use-user", () => ({
  useMyPermissions: () => ({
    data: reads.permissions ? { permissions: reads.permissions } : undefined,
  }),
}));
vi.mock("./use-chapters", () => ({
  useCurrentChapter: () => ({
    data: reads.modules ? { enabled_modules: reads.modules } : undefined,
  }),
  useAccessibleChapters: () => ({
    data: [{ chapter_id: "ch-1", dismissed_ops_nudges: reads.dismissed }],
  }),
}));
vi.mock("./use-members", () => ({
  useMembers: (o: { enabled?: boolean }) => {
    enabledCalls.members = o.enabled;
    return { data: o.enabled ? reads.members : undefined };
  },
  useDismissOpsNudge: () => ({ mutate }),
}));
vi.mock("./use-events", () => ({
  useEvents: (o: { enabled?: boolean }) => {
    enabledCalls.events = o.enabled;
    return { data: o.enabled ? reads.events : undefined };
  },
}));
vi.mock("./use-study", () => ({
  useGeofences: (o: { enabled?: boolean }) => {
    enabledCalls.zones = o.enabled;
    return { data: o.enabled ? reads.zones : undefined };
  },
}));
vi.mock("./use-documents", () => ({
  useDocuments: (o: { enabled?: boolean }) => {
    enabledCalls.documents = o.enabled;
    return { data: o.enabled ? reads.documents : undefined };
  },
}));
vi.mock("./use-invoices", () => ({
  useInvoices: (userId: string | undefined, o: { enabled?: boolean }) => {
    enabledCalls.invoices = o.enabled;
    enabledCalls.invoicesForOneUser = userId !== undefined;
    return { data: o.enabled ? reads.invoices : undefined };
  },
}));

const { useChapterSetupChecklist } = await import("./setup-checklist");

beforeEach(() => {
  reads.permissions = ["*"];
  reads.modules = {};
  reads.dismissed = [];
  reads.members = [{}, {}];
  reads.events = [];
  reads.zones = [];
  reads.documents = [];
  reads.invoices = [];
  mutate.mockClear();
  for (const k of Object.keys(enabledCalls)) delete enabledCalls[k];
});

describe("useChapterSetupChecklist", () => {
  it("counts each line from its own list", () => {
    reads.events = [{}];
    const { result } = renderHook(() => useChapterSetupChecklist());
    expect(result.current.checklist?.lines.map((l) => [l.key, l.done])).toEqual(
      [
        ["invite", true],
        ["event", true],
        ["study-zone", false],
        ["document", false],
        ["dues", false],
      ],
    );
  });

  it("reads the whole chapter's invoices, not just the officer's own", () => {
    renderHook(() => useChapterSetupChecklist());
    expect(enabledCalls.invoicesForOneUser).toBe(false);
  });

  it("reads no list for a line the viewer can't act on", () => {
    reads.permissions = ["members:view", "events:create"];
    const { result } = renderHook(() => useChapterSetupChecklist());
    expect(enabledCalls).toMatchObject({
      members: false,
      events: true,
      zones: false,
      documents: false,
      invoices: false,
    });
    expect(result.current.checklist?.lines.map((l) => l.key)).toEqual([
      "event",
    ]);
  });

  it("honours a hide stored on the membership", () => {
    reads.dismissed = ["setup-checklist"];
    const { result } = renderHook(() => useChapterSetupChecklist());
    expect(result.current.checklist).toBeNull();
  });

  it("hides at once and stores the hide for next time", () => {
    const { result } = renderHook(() => useChapterSetupChecklist());
    expect(result.current.checklist).not.toBeNull();
    act(() => result.current.hide());
    expect(result.current.checklist).toBeNull();
    expect(mutate).toHaveBeenCalledWith(
      { module_key: "setup-checklist" },
      expect.anything(),
    );
  });
});
