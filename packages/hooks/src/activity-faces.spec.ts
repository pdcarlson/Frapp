import { describe, expect, it } from "vitest";
import { activityFaceStack, type ActivityFace } from "./activity-faces";

const face = (name: string): ActivityFace => ({
  name,
  avatarUrl: null,
  tint: { fill: "#eef", text: "#33f" } as ActivityFace["tint"],
});

describe("activityFaceStack (#5492, #5538)", () => {
  const roster: Record<string, ActivityFace> = {
    a: face("Ann"),
    b: face("Ben"),
    c: face("Cy"),
    d: face("Di"),
  };
  const faceFor = (id: string) => roster[id] ?? null;

  it("shows three faces and counts the rest", () => {
    const { faces, more } = activityFaceStack(
      ["a", "b", "c", "d"],
      30,
      faceFor,
    );
    expect(faces.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(more).toBe(27);
  });

  it("skips a member who left and counts them in +N", () => {
    const { faces, more } = activityFaceStack(["gone", "a", "b"], 3, faceFor);
    expect(faces.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(more).toBe(1);
  });

  it("draws nothing when no face resolves", () => {
    expect(activityFaceStack(["gone"], 5, faceFor)).toEqual({
      faces: [],
      more: 0,
    });
  });
});
