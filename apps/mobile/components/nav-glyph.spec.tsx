/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import {
  GLYPH_BACK_OPACITY,
  NAV_GLYPHS,
  type NavGlyphName,
} from "@repo/theme/nav-glyphs";
import { PointsGlyph, ServiceHoursGlyph } from "@/components/chat/card-glyphs";
import {
  ChapterGlyph,
  DirectoryGlyph,
  DocumentsGlyph,
  DuesGlyph,
  HostCheckInGlyph,
  ServiceGlyph,
  SettingsGlyph,
  StudyGlyph,
} from "@/components/more/more-glyphs";
import {
  ChatGlyph,
  EventsGlyph,
  MoreGlyph,
  TasksGlyph,
} from "@/components/tab-glyphs";

const ACCENT = "#F4CB63";
const MUTED = "#78716A";

function renderPaths(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element);
  });
  return tree.root.findAll(
    (node) => (node.type as unknown as string) === "Path",
  );
}

/*
 * The same keys the web glyphs draw (`apps/web/components/layout/
 * nav-glyphs.spec.tsx`): a tab or hub row and its web destination share one
 * shape (iconography.md §1.1).
 */
const TABS: ReadonlyArray<[string, typeof ChatGlyph, NavGlyphName]> = [
  ["Chat", ChatGlyph, "chat"],
  ["Events", EventsGlyph, "events"],
  ["Tasks", TasksGlyph, "tasks"],
  ["More", MoreGlyph, "more"],
  ["Points card", PointsGlyph, "points"],
  ["Hours card", ServiceHoursGlyph, "service"],
];

const HUB: ReadonlyArray<[string, typeof StudyGlyph, NavGlyphName]> = [
  ["Study hours", StudyGlyph, "study"],
  ["Service hours", ServiceGlyph, "service"],
  ["Dues", DuesGlyph, "billing"],
  ["Documents", DocumentsGlyph, "documents"],
  ["Directory", DirectoryGlyph, "directory"],
  ["Settings", SettingsGlyph, "settings"],
  ["Switch chapter", ChapterGlyph, "chapter"],
  ["Host check-in", HostCheckInGlyph, "hostCheckIn"],
];

describe("shared nav glyphs on mobile", () => {
  it.each(TABS)(
    "%s draws its shared shape, lifting the silhouette when focused",
    (_label, Glyph, key) => {
      const [back, front] = renderPaths(
        <Glyph focused accent={ACCENT} muted={MUTED} />,
      );
      expect(back!.props.d).toBe(NAV_GLYPHS[key].back);
      expect(front!.props.d).toBe(NAV_GLYPHS[key].front);
      expect(back!.props.fill).toBe(ACCENT);
      expect(back!.props.fillOpacity).toBe(GLYPH_BACK_OPACITY.active);
      expect(front!.props.fill).toBe(ACCENT);
      expect(front!.props.fillOpacity).toBeUndefined();

      const [restBack, restFront] = renderPaths(
        <Glyph focused={false} accent={ACCENT} muted={MUTED} />,
      );
      expect(restBack!.props.fill).toBe(MUTED);
      expect(restBack!.props.fillOpacity).toBe(GLYPH_BACK_OPACITY.rest);
      expect(restFront!.props.fill).toBe(MUTED);
    },
  );

  it.each(HUB)("%s draws its shared shape at 20%%", (_label, Glyph, key) => {
    const [back, front] = renderPaths(<Glyph color={ACCENT} />);
    expect(back!.props.d).toBe(NAV_GLYPHS[key].back);
    expect(front!.props.d).toBe(NAV_GLYPHS[key].front);
    expect(back!.props.fill).toBe(ACCENT);
    expect(back!.props.fillOpacity).toBe(GLYPH_BACK_OPACITY.rest);
    expect(GLYPH_BACK_OPACITY).toEqual({ rest: 0.2, active: 0.3 });
  });
});
