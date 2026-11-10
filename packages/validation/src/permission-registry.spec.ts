import { describe, expect, it } from "vitest";
import {
  groupPermissionsByModule,
  PERMISSION_MODULES,
  PERMISSION_REGISTRY,
  permissionDefinition,
  permissionLabel,
} from "./permission-registry";

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

  it("reads a Discord import's per-role read gate as the channels it opens", () => {
    expect(permissionLabel("channels:read:exec")).toBe("Read exec channels");
    expect(permissionLabel("channels:read:exec-board")).toBe(
      "Read exec board channels",
    );
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

describe("PERMISSION_REGISTRY", () => {
  it("gives every entry a known module, a label, a description and a scope", () => {
    const modules = new Set<string>(PERMISSION_MODULES.map((m) => m.key));
    for (const entry of PERMISSION_REGISTRY) {
      expect(modules.has(entry.module)).toBe(true);
      expect(entry.label.trim()).not.toBe("");
      expect(entry.description.trim()).not.toBe("");
      expect(entry.scope).toBe("chapter");
    }
  });

  it("lists each permission once", () => {
    const strings = PERMISSION_REGISTRY.map((entry) => entry.permission);
    expect(new Set(strings).size).toBe(strings.length);
  });

  it("files points under Points, not with billing (#3713)", () => {
    expect(permissionDefinition("points:adjust")?.module).toBe("points");
    expect(permissionDefinition("points:view_all")?.module).toBe("points");
    expect(permissionDefinition("billing:manage")?.module).toBe("billing");
  });
});

describe("groupPermissionsByModule", () => {
  const rows = (...permissions: string[]) =>
    permissions.map((permission) => ({ permission }));

  it("groups by module in registry order, whatever order the rows come in", () => {
    const groups = groupPermissionsByModule(
      rows("billing:view", "points:adjust", "roles:manage", "points:view_all"),
    );
    expect(groups.map((g) => g.label)).toEqual([
      "Chapter",
      "Points",
      "Billing",
    ]);
    expect(groups[1]!.entries.map((e) => e.permission)).toEqual([
      "points:adjust",
      "points:view_all",
    ]);
  });

  it("drops the wildcard, which nobody toggles", () => {
    expect(groupPermissionsByModule(rows("*", "events:create"))).toEqual([
      { label: "Events", entries: [{ permission: "events:create" }] },
    ]);
  });

  it("groups a custom string under its own namespace, after the known groups", () => {
    const groups = groupPermissionsByModule(
      rows("fines:waive", "treasury", "events:create", "house_jobs:assign"),
    );
    expect(groups.map((g) => g.label)).toEqual([
      "Chapter",
      "Events",
      "Fines",
      "House jobs",
    ]);
  });

  it("puts a custom string whose namespace is a known group's name in that group", () => {
    const groups = groupPermissionsByModule(
      rows("events:create", "events:cancel_all"),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries).toHaveLength(2);
  });
});
