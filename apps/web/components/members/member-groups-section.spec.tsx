import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemberGroupsSection } from "./member-groups-section";

const groups = vi.hoisted(() => ({ data: undefined as unknown[] | undefined }));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useGroups: () => ({ data: groups.data }),
}));

const group = (id: string, name: string, memberIds: string[]) => ({
  id,
  name,
  kind: "manual",
  color: null,
  member_ids: memberIds,
});

describe("MemberGroupsSection (#4076)", () => {
  it("lists the groups the member is in, and only those", () => {
    groups.data = [
      group("g1", "Third floor", ["u1"]),
      group("g2", "Live-ins", ["u2"]),
      group("g3", "Class of 2027", ["u1", "u2"]),
    ];
    render(<MemberGroupsSection userId="u1" open />);
    expect(screen.getByRole("heading", { name: "Groups" })).toBeTruthy();
    expect(screen.getByText("Third floor")).toBeTruthy();
    expect(screen.getByText("Class of 2027")).toBeTruthy();
    expect(screen.queryByText("Live-ins")).toBeNull();
  });

  it("says No groups when they are in none", () => {
    groups.data = [group("g2", "Live-ins", ["u2"])];
    render(<MemberGroupsSection userId="u1" open />);
    expect(screen.getByText("No groups")).toBeTruthy();
  });

  it("draws nothing before the list loads, never a stand-in No groups", () => {
    groups.data = undefined;
    const { container } = render(<MemberGroupsSection userId="u1" open />);
    expect(container.textContent).toBe("");
  });
});
