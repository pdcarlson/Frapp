import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EventAttendanceDraft } from "@repo/validation";

/**
 * The web Who's coming editor: Everyone else first, a row per role with the
 * same three answers, a one-line summary, and at real scale (a hundred roles)
 * a list that flows with the panel instead of scrolling inside it.
 */

const ROLES = [
  { id: "role-officers", name: "Officers" },
  { id: "role-new", name: "New Members" },
  { id: "role-alumni", name: "Alumni" },
  ...Array.from({ length: 100 }, (_, i) => ({
    id: `role-${i}`,
    name: `Zeta committee ${i}`,
  })),
];

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRoles: () => ({
    data: [{ id: "role-alumni", name: "Alumni", system_key: "ALUMNI" }],
  }),
}));

import { AttendanceEditor } from "./attendance-editor";

let latest: EventAttendanceDraft | undefined;

function Host({
  initial,
  allowRequired,
}: {
  initial: EventAttendanceDraft;
  allowRequired?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <AttendanceEditor
        value={value}
        onChange={(next) => {
          latest = next;
          setValue(next);
        }}
        roles={ROLES}
        rolesState="ready"
        allowRequired={allowRequired}
      />
      <button
        type="button"
        onClick={() =>
          setValue({ everyone: "optional", roles: { "role-50": "required" } })
        }
      >
        Load another event
      </button>
    </>
  );
}

const group = (name: string) => screen.getByRole("radiogroup", { name });
const rowNames = () =>
  within(screen.getByRole("list", { name: "Roles" }))
    .getAllByRole("radiogroup")
    .map((each) => each.getAttribute("aria-label"));

describe("AttendanceEditor", () => {
  it("sets a role apart from its row, lights it, and says so in one line", () => {
    render(<Host initial={{ everyone: "optional", roles: {} }} />);
    expect(screen.getByText("Optional for everyone")).toBeTruthy();
    fireEvent.click(
      within(group("Attendance for Officers")).getByRole("radio", {
        name: "Required",
      }),
    );
    expect(latest).toEqual({
      everyone: "optional",
      roles: { "role-officers": "required" },
    });
    expect(
      screen.getByText("Officers required, everyone else optional"),
    ).toBeTruthy();
    // Lit (accent) when set apart, neutral while it follows everyone else.
    expect(
      within(group("Attendance for Officers")).getByRole("radio", {
        name: "Required",
      }).className,
    ).toContain("bg-accent-subtle");
    expect(
      within(group("Attendance for Alumni")).getByRole("radio", {
        name: "Optional",
      }).className,
    ).toContain("bg-card");
  });

  it("flows with the panel: a few rows, then Show all, and search past eight", () => {
    render(<Host initial={{ everyone: "optional", roles: {} }} />);
    expect(rowNames()).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Show all 103 roles" }));
    expect(rowNames()).toHaveLength(103);
    fireEvent.change(screen.getByLabelText("Search roles"), {
      target: { value: "new mem" },
    });
    expect(rowNames()).toEqual(["Attendance for New Members"]);
  });

  it("keeps the order while editing, and leads with another event's roles when the form loads it", () => {
    render(
      <Host
        initial={{
          everyone: "optional",
          roles: { "role-officers": "required" },
        }}
      />,
    );
    expect(rowNames()[0]).toBe("Attendance for Officers");
    fireEvent.click(
      within(group("Attendance for New Members")).getByRole("radio", {
        name: "Required",
      }),
    );
    expect(rowNames()[0]).toBe("Attendance for Officers");
    expect(rowNames()[1]).toBe("Attendance for Alumni");
    fireEvent.click(screen.getByRole("button", { name: "Load another event" }));
    expect(rowNames()[0]).toBe("Attendance for Zeta committee 50");
  });

  it("drops Required when it isn't allowed, but keeps a row already Required readable", () => {
    render(
      <Host
        initial={{
          everyone: "optional",
          roles: { "role-officers": "required" },
        }}
        allowRequired={false}
      />,
    );
    const answers = (name: string) =>
      within(group(name))
        .getAllByRole("radio")
        .map((each) => each.textContent);
    expect(answers("Attendance for everyone else")).toEqual([
      "Optional",
      "Not invited",
    ]);
    expect(answers("Attendance for Officers")).toEqual([
      "Required",
      "Optional",
      "Not invited",
    ]);
  });

  it("says the Alumni role is left out while it follows everyone else", () => {
    render(<Host initial={{ everyone: "required", roles: {} }} />);
    expect(screen.getByText("Left out unless set here")).toBeTruthy();
  });
});
