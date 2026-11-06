/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reads, enabledCalls, mutate, refetched } = vi.hoisted(() => ({
  reads: {
    chapterId: "ch-1",
    permissions: ["*"] as string[] | undefined,
    modules: {} as Record<string, boolean> | undefined,
    dismissed: {} as Record<string, string[]>,
    roster: [{}, {}] as unknown[],
    invites: [] as unknown[],
    events: [] as unknown[],
    zones: [] as unknown[],
    documents: [] as unknown[],
    invoices: [] as unknown[],
  },
  enabledCalls: {} as Record<string, boolean | undefined>,
  mutate: vi.fn(),
  refetched: [] as string[],
}));

vi.mock("./use-frapp-client", () => ({
  useActiveChapterId: () => reads.chapterId,
}));
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
    data: ["ch-1", "ch-2"].map((id) => ({
      chapter_id: id,
      dismissed_ops_nudges: reads.dismissed[id] ?? [],
    })),
  }),
}));
vi.mock("./use-members", () => ({
  useChapterRoster: () => ({
    data: reads.roster,
    refetch: () => refetched.push("roster"),
  }),
  useDismissOpsNudge: () => ({ mutate }),
}));
vi.mock("./use-invites", () => ({
  useInvites: (o: { enabled?: boolean }) => {
    enabledCalls.invites = o.enabled;
    return {
      data: o.enabled ? reads.invites : undefined,
      refetch: () => refetched.push("invites"),
    };
  },
}));
vi.mock("./use-events", () => ({
  useEvents: (o: { enabled?: boolean }) => {
    enabledCalls.events = o.enabled;
    return {
      data: o.enabled ? reads.events : undefined,
      refetch: () => refetched.push("events"),
    };
  },
}));
vi.mock("./use-study", () => ({
  useGeofences: (o: { enabled?: boolean }) => {
    enabledCalls.zones = o.enabled;
    return {
      data: o.enabled ? reads.zones : undefined,
      refetch: () => refetched.push("zones"),
    };
  },
}));
vi.mock("./use-documents", () => ({
  useDocuments: (o: { enabled?: boolean }) => {
    enabledCalls.documents = o.enabled;
    return {
      data: o.enabled ? reads.documents : undefined,
      refetch: () => refetched.push("documents"),
    };
  },
}));
vi.mock("./use-invoices", () => ({
  useInvoices: (userId: string | undefined, o: { enabled?: boolean }) => {
    enabledCalls.invoices = o.enabled;
    enabledCalls.invoicesForOneUser = userId !== undefined;
    return {
      data: o.enabled ? reads.invoices : undefined,
      refetch: () => refetched.push("invoices"),
    };
  },
}));

const { useChapterSetupChecklist } = await import("./setup-checklist");

beforeEach(() => {
  reads.chapterId = "ch-1";
  reads.permissions = ["*"];
  reads.modules = {};
  reads.dismissed = {};
  reads.roster = [{}, {}];
  reads.invites = [];
  reads.events = [];
  reads.zones = [];
  reads.documents = [];
  reads.invoices = [];
  mutate.mockClear();
  refetched.length = 0;
  for (const k of Object.keys(enabledCalls)) delete enabledCalls[k];
});

describe("useChapterSetupChecklist", () => {
  it("counts each line from its own list, invites from the roster", () => {
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

  it("counts a sent invite before anyone has joined", () => {
    reads.roster = [{}];
    const { result, rerender } = renderHook(() => useChapterSetupChecklist());
    expect(result.current.checklist?.lines[0]).toMatchObject({
      key: "invite",
      done: false,
    });
    reads.invites = [{}];
    rerender();
    expect(result.current.checklist?.lines[0]).toMatchObject({
      key: "invite",
      done: true,
    });
  });

  it("reads the whole chapter's invoices, not just the officer's own", () => {
    renderHook(() => useChapterSetupChecklist());
    expect(enabledCalls.invoicesForOneUser).toBe(false);
  });

  it("reads no list for a line the viewer can't act on", () => {
    reads.permissions = ["members:view", "events:create"];
    const { result } = renderHook(() => useChapterSetupChecklist());
    expect(enabledCalls).toMatchObject({
      invites: false,
      events: true,
      zones: false,
      documents: false,
      invoices: false,
    });
    expect(result.current.checklist?.lines.map((l) => l.key)).toEqual([
      "event",
    ]);
  });

  it("honours a hide stored on the membership, and reads nothing for it", () => {
    reads.dismissed = { "ch-1": ["setup-checklist"] };
    const { result } = renderHook(() => useChapterSetupChecklist());
    expect(result.current.checklist).toBeNull();
    expect(enabledCalls).toMatchObject({
      invites: false,
      events: false,
      zones: false,
      documents: false,
      invoices: false,
    });
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

  it("keeps a hide to the chapter it was made in", () => {
    const { result, rerender } = renderHook(() => useChapterSetupChecklist());
    act(() => result.current.hide());
    reads.chapterId = "ch-2";
    rerender();
    expect(result.current.checklist).not.toBeNull();
  });

  it("leaves out a line a client omits, and reads nothing for it", () => {
    const { result } = renderHook(() =>
      useChapterSetupChecklist({ omit: ["dues"] }),
    );
    expect(enabledCalls.invoices).toBe(false);
    expect(result.current.checklist?.lines.map((l) => l.key)).not.toContain(
      "dues",
    );
  });

  it("refetches only the lists it reads", async () => {
    reads.permissions = ["events:create", "geofences:manage"];
    const { result } = renderHook(() => useChapterSetupChecklist());
    await act(() => result.current.refetch());
    expect(refetched.sort()).toEqual(["events", "zones"]);
  });
});
