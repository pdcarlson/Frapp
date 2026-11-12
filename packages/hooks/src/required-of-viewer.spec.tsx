/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The Mandatory chip is the viewer's own answer under attendance by role
 * (`spec/behavior/events.md` § Event Creation), not the event's raw
 * `is_mandatory`.
 */

let roleIds: string[] = [];
vi.mock("./use-frapp-client", () => ({
  useActiveChapterId: () => "chapter-1",
  useFrappClient: () => ({}),
}));
vi.mock("./use-roles", () => ({
  useRoles: () => ({
    data: [
      { id: "alumni", system_key: "ALUMNI" },
      { id: "officer", system_key: null },
    ],
  }),
}));
vi.mock("./use-chapters", () => ({
  useListChapters: () => ({
    data: [
      { chapter_id: "chapter-0", role_ids: ["officer"] },
      { chapter_id: "chapter-1", role_ids: roleIds },
    ],
  }),
}));

import { useRequiredOfViewer } from "./use-event-excuses";

const requiredOf = (ids: string[]) => {
  roleIds = ids;
  return renderHook(() => useRequiredOfViewer()).result.current;
};

describe("useRequiredOfViewer", () => {
  const officersRequired = {
    is_mandatory: false,
    required_role_ids: ["officer"],
    others_invited: true,
  };

  it("marks an event required of the viewer's role", () => {
    expect(requiredOf(["officer"])(officersRequired)).toBe(true);
  });

  it("leaves it optional for everyone else, and reads the active chapter only", () => {
    // The viewer is an officer in another chapter, not this one.
    expect(requiredOf(["member"])(officersRequired)).toBe(false);
  });

  it("lets a role excuse the viewer from a default of required", () => {
    const event = {
      is_mandatory: true,
      optional_role_ids: ["alumni"],
      others_invited: true,
    };
    expect(requiredOf(["alumni"])(event)).toBe(false);
    expect(requiredOf(["member"])(event)).toBe(true);
  });

  it("holds an alumnus only to an event that names one of their roles", () => {
    // The server's rule (`holdsTo`): the default alone never holds them.
    const everyone = { is_mandatory: true, others_invited: true };
    expect(requiredOf(["alumni"])(everyone)).toBe(false);
    expect(
      requiredOf(["alumni"])({ ...everyone, required_role_ids: ["alumni"] }),
    ).toBe(true);
  });
});
