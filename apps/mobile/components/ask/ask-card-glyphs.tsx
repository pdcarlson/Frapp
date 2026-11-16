import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * The small marks on an Ask proposed card (#5148): one for the kind of card
 * on its top line, and one beside each detail, where the card used to print
 * an all-caps label (Paul, 2026-11-16: "the card could be refactored to look
 * nicer and be clearer"). Web draws the same pictures from Lucide
 * (`CalendarDays`, `ListChecks`, `Star`, `Users`, `Repeat`, `User`, `Clock`,
 * `AlignLeft`, `CircleCheck`, `CircleX`); these are those outlines, drawn at
 * the same 24 grid with a 1.8 stroke. Decorative: the row's words carry the
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

export function AskCardGlyph({
  name,
  color,
  size = 16,
}: {
  name: AskCardGlyphName;
  color: string;
  size?: number;
}) {
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
      {name === "event" ? (
        <>
          <Rect x={3.5} y={5} width={17} height={15} rx={3} {...stroke} />
          <Path d="M3.5 10h17M8 3v4M16 3v4" {...stroke} />
        </>
      ) : null}
      {name === "task" ? (
        <>
          <Rect x={4} y={4} width={16} height={16} rx={4} {...stroke} />
          <Path d="M8.5 12.2l2.4 2.4 4.8-5" {...stroke} />
        </>
      ) : null}
      {name === "points" ? (
        <Path
          d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4-3.9-3.8 5.4-.8z"
          {...stroke}
        />
      ) : null}
      {name === "people" ? (
        <>
          <Circle cx={9} cy={9} r={3.2} {...stroke} />
          <Path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" {...stroke} />
          <Circle cx={16.5} cy={9.5} r={2.5} {...stroke} />
          <Path d="M16 14.5c2.4 0 4 1.3 4.6 3.8" {...stroke} />
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
      {name === "clock" ? (
        <>
          <Circle cx={12} cy={12} r={8} {...stroke} />
          <Path d="M12 7.5V12l3 2" {...stroke} />
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
