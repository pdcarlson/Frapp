import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { AskStepKind } from "@repo/validation";

/**
 * The small mark for each kind of read in Ask's step list (#5427). Web draws
 * the same pictures from Lucide (`MessagesSquare`, `Hash`, `FileSearch`,
 * `FileText`, `NotebookText`, `CalendarDays`, `UserCheck`, `Users`,
 * `ListChecks`, `Star`, `Wallet`, `Clock`, `BookOpen`, `Dot`); these are those
 * outlines on the same 24 grid with a 1.8 stroke, as `ask-card-glyphs.tsx`
 * draws the card's. Decorative: the row's words carry the meaning.
 */
export function AskStepGlyph({
  kind,
  color,
  size = 15,
}: {
  kind: AskStepKind;
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
      {kind === "chat" ? (
        <>
          <Path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" {...stroke} />
          <Path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" {...stroke} />
        </>
      ) : null}
      {kind === "channels" ? (
        <Path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" {...stroke} />
      ) : null}
      {kind === "records" ? (
        <>
          <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h4" {...stroke} />
          <Path d="M14 2v4a2 2 0 0 0 2 2h4v3" {...stroke} />
          <Circle cx={16.5} cy={17.5} r={2.5} {...stroke} />
          <Path d="m18.5 19.5 2.5 2.5" {...stroke} />
        </>
      ) : null}
      {kind === "document" ? (
        <>
          <Path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" {...stroke} />
          <Path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8" {...stroke} />
        </>
      ) : null}
      {kind === "minutes" ? (
        <>
          <Path d="M2 6h4M2 10h4M2 14h4M2 18h4" {...stroke} />
          <Rect x={4} y={2} width={16} height={20} rx={2} {...stroke} />
          <Path d="M9.5 8h5M9.5 12H16M9.5 16H14" {...stroke} />
        </>
      ) : null}
      {kind === "events" ? (
        <>
          <Rect x={3} y={4} width={18} height={18} rx={2} {...stroke} />
          <Path d="M16 2v4M8 2v4M3 10h18" {...stroke} />
        </>
      ) : null}
      {kind === "attendance" ? (
        <>
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" {...stroke} />
          <Circle cx={9} cy={7} r={4} {...stroke} />
          <Path d="m16 11 2 2 4-4" {...stroke} />
        </>
      ) : null}
      {kind === "people" ? (
        <>
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" {...stroke} />
          <Circle cx={9} cy={7} r={4} {...stroke} />
          <Path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" {...stroke} />
        </>
      ) : null}
      {kind === "tasks" ? (
        <Path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8" {...stroke} />
      ) : null}
      {kind === "points" ? (
        <Path
          d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"
          {...stroke}
        />
      ) : null}
      {kind === "dues" ? (
        <>
          <Path
            d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"
            {...stroke}
          />
          <Path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" {...stroke} />
        </>
      ) : null}
      {kind === "hours" ? (
        <>
          <Circle cx={12} cy={12} r={10} {...stroke} />
          <Path d="M12 6v6l4 2" {...stroke} />
        </>
      ) : null}
      {kind === "backwork" ? (
        <>
          <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" {...stroke} />
          <Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" {...stroke} />
        </>
      ) : null}
      {kind === "other" ? <Circle cx={12} cy={12} r={2.5} {...stroke} /> : null}
    </Svg>
  );
}

/** A step's end mark: a tick, a dash for nothing found, a cross for a failed read. */
export function AskStepEndGlyph({
  state,
  color,
  size = 15,
}: {
  state: "done" | "nothing" | "failed";
  color: string;
  size?: number;
}) {
  const stroke = {
    stroke: color,
    strokeWidth: 2,
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
      {state === "done" ? <Path d="M20 6 9 17l-5-5" {...stroke} /> : null}
      {state === "nothing" ? <Path d="M5 12h14" {...stroke} /> : null}
      {state === "failed" ? <Path d="M18 6 6 18M6 6l12 12" {...stroke} /> : null}
    </Svg>
  );
}
