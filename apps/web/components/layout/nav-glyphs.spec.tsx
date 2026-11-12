import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  GLYPH_BACK_OPACITY,
  NAV_GLYPHS,
  type NavGlyphName,
} from "@repo/theme/nav-glyphs";
import { FolderGlyph } from "@/components/documents/resources-glyphs";
import { ScheduleGlyph } from "@/components/events/chapter-ops-glyphs";
import { InviteGlyph } from "@/components/members/directory-glyphs";
import { ProfileGlyph } from "@/components/profile/profile-glyphs";
import type { DuotoneGlyphComponent } from "@/components/ui/duotone";
import {
  ActivityGlyph,
  BackworkGlyph,
  BillingGlyph,
  ChatGlyph,
  DirectMessagesGlyph,
  DirectoryGlyph,
  DocumentsGlyph,
  EventsGlyph,
  PointsGlyph,
  PollsGlyph,
  ReportsGlyph,
  RolesGlyph,
  ServiceGlyph,
  SettingsGlyph,
  StudyGlyph,
  StudyZonesGlyph,
  TasksGlyph,
} from "./nav-glyphs";

/*
 * The shape each web glyph draws from the shared set. The mobile tab bar and
 * More hub draw the same keys (`apps/mobile/components/nav-glyph.spec.tsx`), so
 * this table is half of the "one destination, one shape" check
 * (iconography.md §1.1).
 */
const SHAPES: ReadonlyArray<[string, DuotoneGlyphComponent, NavGlyphName]> = [
  ["Chat", ChatGlyph, "chat"],
  ["Direct messages", DirectMessagesGlyph, "direct"],
  ["Activity", ActivityGlyph, "activity"],
  ["Events", EventsGlyph, "events"],
  ["Tasks", TasksGlyph, "tasks"],
  ["Points", PointsGlyph, "points"],
  ["Study hours", StudyGlyph, "study"],
  ["Service hours", ServiceGlyph, "service"],
  ["Polls", PollsGlyph, "polls"],
  ["Documents", DocumentsGlyph, "documents"],
  ["Backwork", BackworkGlyph, "backwork"],
  ["Directory", DirectoryGlyph, "directory"],
  ["Billing", BillingGlyph, "billing"],
  ["Settings", SettingsGlyph, "settings"],
  ["Roles", RolesGlyph, "roles"],
  ["Study zones", StudyZonesGlyph, "studyZones"],
  ["Reports", ReportsGlyph, "reports"],
  ["Folder", FolderGlyph, "folder"],
  ["Schedule", ScheduleGlyph, "schedule"],
  ["Invite", InviteGlyph, "invite"],
  ["Profile", ProfileGlyph, "profile"],
];

function paths(Glyph: DuotoneGlyphComponent, active?: boolean) {
  const { container } = render(<Glyph className="h-4 w-4" active={active} />);
  return Array.from(container.querySelectorAll("svg > path"));
}

describe("shared nav glyphs on web", () => {
  it.each(SHAPES)(
    "%s draws its shared shape and lifts it when active",
    (_label, Glyph, key) => {
      const [back, front] = paths(Glyph);
      expect(back?.getAttribute("d")).toBe(NAV_GLYPHS[key].back);
      expect(front?.getAttribute("d")).toBe(NAV_GLYPHS[key].front);
      expect(Number(back?.getAttribute("opacity"))).toBe(
        GLYPH_BACK_OPACITY.rest,
      );
      const [activeBack] = paths(Glyph, true);
      expect(Number(activeBack?.getAttribute("opacity"))).toBe(
        GLYPH_BACK_OPACITY.active,
      );
    },
  );

  it("draws the silhouette at 20% at rest and 30% when active, never solid", () => {
    const [restBack, restFront] = paths(SettingsGlyph);
    const [activeBack] = paths(SettingsGlyph, true);
    expect(Number(restBack?.getAttribute("opacity"))).toBe(
      GLYPH_BACK_OPACITY.rest,
    );
    expect(Number(activeBack?.getAttribute("opacity"))).toBe(
      GLYPH_BACK_OPACITY.active,
    );
    expect(GLYPH_BACK_OPACITY).toEqual({ rest: 0.2, active: 0.3 });
    // The outline carries no opacity of its own: it is the full-strength tone.
    expect(restFront?.hasAttribute("opacity")).toBe(false);
  });

  it("paints in currentColor and stays hidden from assistive technology", () => {
    const { container } = render(<ChatGlyph className="h-4 w-4" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("fill")).toBe("currentColor");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("class")).toBe("h-4 w-4");
  });
});
