import { describe, expect, it } from "vitest";
import {
  resolveCustomRoleNames,
  resolveRoleNames,
  selectMemberDetail,
} from "./member-detail";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    user_id: "u-1",
    chapter_id: "c-1",
    role_ids: ["r-1", "r-2"],
    custom_role_ids: ["cr-1"],
    has_completed_onboarding: true,
    created_at: "2026-08-21T12:00:00.000Z",
    updated_at: "2026-08-21T12:00:00.000Z",
    display_name: "Ada Lovelace",
    avatar_url: null,
    bio: "Loves a good algorithm.",
    graduation_year: 2027,
    current_city: "Chicago",
    current_company: "Acme Inc.",
    email: "ada@example.edu",
    custom_fields: [
      { field_id: "f-1", key: "shirt_size", label: "Shirt size", type: "text", visibility: "chapter", value: "M" },
      { field_id: "f-2", key: "vaccinated", label: "Vaccinated", type: "boolean", visibility: "chapter", value: "true" },
    ],
    ...overrides,
  };
}

describe("selectMemberDetail", () => {
  it("maps the full profile", () => {
    const detail = selectMemberDetail(profile());
    expect(detail).toEqual({
      userId: "u-1",
      displayName: "Ada Lovelace",
      initials: "AL",
      email: "ada@example.edu",
      bio: "Loves a good algorithm.",
      meta: "Acme Inc. · Chicago · '27",
      joinedLabel: "Aug 21, 2026",
      roleIds: ["r-1", "r-2"],
      customRoleIds: ["cr-1"],
      customFields: [
        { fieldId: "f-1", label: "Shirt size", value: "M" },
        { fieldId: "f-2", label: "Vaccinated", value: "Yes" },
      ],
    });
  });

  it("falls back to a placeholder name for an empty display_name", () => {
    const detail = selectMemberDetail(profile({ display_name: "" }));
    expect(detail?.displayName).toBe("Unnamed member");
  });

  it("omits meta parts that are unset, without a dangling separator", () => {
    const detail = selectMemberDetail(
      profile({ current_company: null, current_city: null, graduation_year: null }),
    );
    expect(detail?.meta).toBeNull();
  });

  it("drops bio and email when unset rather than rendering an empty string", () => {
    const detail = selectMemberDetail(profile({ bio: null, email: "" }));
    expect(detail?.bio).toBeNull();
    expect(detail?.email).toBeNull();
  });

  it("returns null for an unreadable payload", () => {
    expect(selectMemberDetail(undefined)).toBeNull();
    expect(selectMemberDetail({})).toBeNull();
    expect(selectMemberDetail({ user_id: "" })).toBeNull();
  });

  it("drops a non-string role id rather than throwing", () => {
    const detail = selectMemberDetail(profile({ role_ids: ["r-1", 7, null] }));
    expect(detail?.roleIds).toEqual(["r-1"]);
  });

  it("returns no custom fields when absent", () => {
    const detail = selectMemberDetail(profile({ custom_fields: undefined }));
    expect(detail?.customFields).toEqual([]);
  });

  it("formats a boolean custom field as Yes/No and a null value as an em dash", () => {
    const detail = selectMemberDetail(
      profile({
        custom_fields: [
          { field_id: "f-1", label: "Vaccinated", type: "boolean", value: "false" },
          { field_id: "f-2", label: "Notes", type: "text", value: null },
        ],
      }),
    );
    expect(detail?.customFields).toEqual([
      { fieldId: "f-1", label: "Vaccinated", value: "No" },
      { fieldId: "f-2", label: "Notes", value: "—" },
    ]);
  });

  it("drops a custom field missing an id or label", () => {
    const detail = selectMemberDetail(
      profile({
        custom_fields: [
          { field_id: "", label: "Shirt size", type: "text", value: "M" },
          { field_id: "f-2", label: "", type: "text", value: "M" },
        ],
      }),
    );
    expect(detail?.customFields).toEqual([]);
  });
});

describe("resolveRoleNames", () => {
  const roles = [
    { id: "r-1", name: "President" },
    { id: "r-2", name: "Treasurer" },
  ];

  it("resolves ids to names in the given order", () => {
    expect(resolveRoleNames(roles, ["r-2", "r-1"])).toEqual([
      "Treasurer",
      "President",
    ]);
  });

  it("drops an id with no match rather than rendering a raw id", () => {
    expect(resolveRoleNames(roles, ["r-1", "r-deleted"])).toEqual(["President"]);
  });

  it("returns nothing for an empty role list without reading rolesData", () => {
    expect(resolveRoleNames(undefined, [])).toEqual([]);
  });

  it("returns nothing while the roles list hasn't loaded", () => {
    expect(resolveRoleNames(undefined, ["r-1"])).toEqual([]);
  });

  it("contributes a duplicated role id's name only once", () => {
    expect(resolveRoleNames(roles, ["r-1", "r-1", "r-2"])).toEqual([
      "President",
      "Treasurer",
    ]);
  });
});

describe("resolveCustomRoleNames", () => {
  const customRoles = [
    { id: "cr-1", label: "Rush Chair" },
    { id: "cr-2", label: "Social Chair" },
  ];

  it("resolves ids to labels", () => {
    expect(resolveCustomRoleNames(customRoles, ["cr-1"])).toEqual([
      "Rush Chair",
    ]);
  });

  it("returns nothing when the viewer cannot resolve them (data undefined)", () => {
    expect(resolveCustomRoleNames(undefined, ["cr-1"])).toEqual([]);
  });

  it("returns nothing for an empty id list", () => {
    expect(resolveCustomRoleNames(customRoles, [])).toEqual([]);
  });

  it("drops a duplicate and an unmatched id", () => {
    expect(
      resolveCustomRoleNames(customRoles, ["cr-1", "cr-1", "cr-deleted"]),
    ).toEqual(["Rush Chair"]);
  });
});
