import { describe, expect, it } from "vitest";
import { selectMemberDetail } from "./member-detail";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    user_id: "u-1",
    chapter_id: "c-1",
    role_ids: ["r-1", "r-2"],
    custom_role_ids: [],
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
      {
        field_id: "f-1",
        key: "shirt_size",
        label: "Shirt size",
        type: "text",
        visibility: "chapter",
        value: "M",
      },
      {
        field_id: "f-2",
        key: "vaccinated",
        label: "Vaccinated",
        type: "boolean",
        visibility: "chapter",
        value: "true",
      },
    ],
    ...overrides,
  };
}

describe("selectMemberDetail", () => {
  it("maps the full profile", () => {
    const detail = selectMemberDetail(profile());
    expect(detail).toEqual({
      memberId: "m-1",
      userId: "u-1",
      avatarUrl: null,
      displayName: "Ada Lovelace",
      storedName: "Ada Lovelace",
      initials: "AL",
      email: "ada@example.edu",
      phone: null,
      graduationYear: 2027,
      bio: "Loves a good algorithm.",
      meta: "Acme Inc. · Chicago · '27",
      joinedLabel: "August 21, 2026",
      roleIds: ["r-1", "r-2"],
      customFields: [
        { fieldId: "f-1", label: "Shirt size", value: "M" },
        { fieldId: "f-2", label: "Vaccinated", value: "Yes" },
      ],
      pledgeClassId: null,
      orderNumber: null,
      canRemove: false,
      canEditProfile: false,
    });
  });

  it("carries the phone and the API's viewer_can_edit_profile (#3711, #4367)", () => {
    const detail = selectMemberDetail(
      profile({ phone: "(518) 555-0142", viewer_can_edit_profile: true }),
    );
    expect(detail?.phone).toBe("(518) 555-0142");
    expect(detail?.canEditProfile).toBe(true);
    expect(
      selectMemberDetail(profile({ viewer_can_edit_profile: "true" }))
        ?.canEditProfile,
    ).toBe(false);
  });

  it("carries the API's viewer_can_remove, and only a literal true", () => {
    expect(
      selectMemberDetail(profile({ viewer_can_remove: true }))?.canRemove,
    ).toBe(true);
    expect(
      selectMemberDetail(profile({ viewer_can_remove: "true" }))?.canRemove,
    ).toBe(false);
  });

  it("carries the member's pledge class and order number when set (#3939)", () => {
    const detail = selectMemberDetail(
      profile({ pledge_class_id: "pc-1", order_number: 12 }),
    );
    expect(detail?.pledgeClassId).toBe("pc-1");
    expect(detail?.orderNumber).toBe(12);
  });

  it("falls back to the shared member label for an empty display_name", () => {
    const detail = selectMemberDetail(profile({ display_name: "" }));
    expect(detail?.displayName).toBe("Member u-1");
  });

  it("omits meta parts that are unset, without a dangling separator", () => {
    const detail = selectMemberDetail(
      profile({
        current_company: null,
        current_city: null,
        graduation_year: null,
      }),
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
          {
            field_id: "f-1",
            label: "Vaccinated",
            type: "boolean",
            value: "false",
          },
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
