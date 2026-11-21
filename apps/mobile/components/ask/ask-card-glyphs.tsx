import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { AskStepKind } from "@repo/validation";
import { AskStepGlyph } from "./ask-step-glyphs";

/**
 * The small marks on an Ask proposed card (#5148): one for the kind of card
 * on its top line, and one beside each detail, where the card used to print
 * an all-caps label (Paul, 2026-11-16: "the card could be refactored to look
 * nicer and be clearer"). Web draws the same pictures from Lucide
 * (`CalendarDays`, `ListChecks`, `Star`, `Users`, `Repeat`, `User`, `Clock`,
 * `AlignLeft`, `CircleCheck`, `CircleX`); these are those outlines, drawn at
 * the same 24 grid with a 1.8 stroke. The calendar, people, star and clock
 * are the step list's (`ask-step-glyphs.tsx`, #5427), Lucide's own paths. Decorative: the row's words carry the
 * meaning, so each is hidden from the screen reader.
 */

export type AskCardGlyphName =
  | "event"
  | "task"
  | "points"
  | "people"
  | "repeat"
  | "person"
  | "clock"
  | "reason"
  | "done"
  | "dismissed";

const SHARED: Partial<Record<AskCardGlyphName, AskStepKind>> = {
  event: "events",
  people: "people",
  points: "points",
  clock: "hours",
};

export function AskCardGlyph({
  name,
  color,
  size = 16,
}: {
  name: AskCardGlyphName;
  color: string;
  size?: number;
}) {
  // What the step list also draws is drawn once, from the step's own glyph
  // (#5427), so a turn that read the calendar and offers an event shows one
  // calendar.
  const shared = SHARED[name];
  if (shared) return <AskStepGlyph kind={shared} color={color} size={size} />;
  const stroke = {
    stroke: color,
    strokeWidth: 1.8,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {name === "task" ? (
        <>
          <Rect x={4} y={4} width={16} height={16} rx={4} {...stroke} />
          <Path d="M8.5 12.2l2.4 2.4 4.8-5" {...stroke} />
        </>
      ) : null}
      {name === "repeat" ? (
        <Path
          d="M5 11V9.5A3.5 3.5 0 0 1 8.5 6H18m0 0l-3-3m3 3l-3 3M19 13v1.5a3.5 3.5 0 0 1-3.5 3.5H6m0 0l3 3m-3-3l3-3"
          {...stroke}
        />
      ) : null}
      {name === "person" ? (
        <>
          <Circle cx={12} cy={8.5} r={3.5} {...stroke} />
          <Path d="M5 19.5c.8-3.3 3.7-5 7-5s6.2 1.7 7 5" {...stroke} />
        </>
      ) : null}
      {name === "reason" ? (
        <Path d="M6 6h12M6 11h12M6 16h8" {...stroke} />
      ) : null}
      {name === "done" ? (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Path d="M8.3 12.3l2.5 2.5 4.9-5.1" {...stroke} />
        </>
      ) : null}
      {name === "dismissed" ? (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" {...stroke} />
        </>
      ) : null}
    </Svg>
  );
}
