import { describe, expect, it } from "vitest";
import { permissionLabel } from "./permission-labels";

describe("permissionLabel", () => {
  it("words a catalog permission the way rbac.md's Grants column does", () => {
    expect(permissionLabel("events:create")).toBe("Create events");
    expect(permissionLabel("points:view_all")).toBe(
      "See every member's points",
    );
    expect(permissionLabel("chapter_docs:manage")).toBe("Manage documents");
  });

  it("reads an unknown permission from its own string, never blank", () => {
    expect(permissionLabel("fines:waive")).toBe("Waive fines");
    expect(permissionLabel("house_jobs:assign_all")).toBe(
      "Assign all house jobs",
    );
    expect(permissionLabel("treasury")).toBe("Treasury");
  });

  it("never prints the API constant's SCREAMING_SNAKE name", () => {
    for (const permission of [
      "events:create",
      "billing:manage",
      "alumni:post",
    ]) {
      expect(permissionLabel(permission)).not.toMatch(/^[A-Z_]+$/);
    }
  });
});
