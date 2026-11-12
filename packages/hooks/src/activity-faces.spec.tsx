import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const tint = { fill: "#123", text: "#456" };
vi.mock("./use-members", () => ({
  // The roster: Olive with a photo, and Pat, who never set a name.
  useMemberDisplayNames: () => ({
    byId: { olive: "Olive Officer", pat: "" },
    nameFor: (id: string) => (id === "olive" ? "Olive Officer" : null),
    avatarFor: (id: string) => (id === "olive" ? "https://photos/olive" : null),
    avatarTintFor: () => tint,
  }),
}));

const { useActivityFaces } = await import("./activity-faces");

describe("useActivityFaces (#4402, item 4)", () => {
  it("resolves a member on the roster to their photo, name and tint", () => {
    const { result } = renderHook(() => useActivityFaces());
    expect(result.current("olive")).toEqual({
      name: "Olive Officer",
      avatarUrl: "https://photos/olive",
      tint,
    });
  });

  it("still shows a member on the roster who never set a name", () => {
    const { result } = renderHook(() => useActivityFaces());
    expect(result.current("pat")).toEqual({
      name: null,
      avatarUrl: null,
      tint,
    });
  });

  it("gives no face for someone the roster no longer holds", () => {
    const { result } = renderHook(() => useActivityFaces());
    expect(result.current("left")).toBeNull();
  });
});
