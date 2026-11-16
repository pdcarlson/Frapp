import { formatMinutesRounded } from "./minutes";

/** The parts of Activity's weekly recap, as the API names them. */
export type RecapFigureId = "events" | "tasks" | "points" | "service" | "study";

/** The recap's numbers: `GET /v1/activity/recap`, `null` for a part that's off. */
export interface RecapCounts {
  events_attended: number | null;
  tasks_done: number | null;
  points: number | null;
  service_minutes: number | null;
  study_minutes: number | null;
}

/** One figure on the recap: "3" and "events". */
export interface RecapFigure {
  id: RecapFigureId;
  figure: string;
  label: string;
  /** The figure in a few words: "3 events attended". */
  spokenLabel: string;
}

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

/**
 * The recap's figures in the words Activity's "Last week" card draws them in
 * (`activityRecapCard` in `@repo/hooks`), and the weekly recap push says them
 * in (#4985, the API's `ActivityRecapPushService`, which joins the spoken
 * labels). One wording here, so the push can't drift from the card. A part
 * that is off, unread or zero is left out.
 */
export function recapFigures(recap: RecapCounts): RecapFigure[] {
  const figures: RecapFigure[] = [];
  const {
    events_attended,
    tasks_done,
    points,
    service_minutes,
    study_minutes,
  } = recap;
  if (events_attended) {
    const label = plural(events_attended, "event", "events");
    figures.push({
      id: "events",
      figure: String(events_attended),
      label,
      spokenLabel: `${events_attended} ${label} attended`,
    });
  }
  if (tasks_done) {
    const label = plural(tasks_done, "task done", "tasks done");
    figures.push({
      id: "tasks",
      figure: String(tasks_done),
      label,
      spokenLabel: `${tasks_done} ${label}`,
    });
  }
  if (points) {
    const label = plural(Math.abs(points), "point", "points");
    figures.push({
      id: "points",
      figure: points > 0 ? `+${points}` : String(points),
      label,
      spokenLabel:
        points > 0 ? `${points} ${label} earned` : `${-points} ${label} lost`,
    });
  }
  if (service_minutes) {
    const time = formatMinutesRounded(service_minutes);
    figures.push({
      id: "service",
      figure: time,
      label: "service",
      spokenLabel: `${time} of service`,
    });
  }
  if (study_minutes) {
    const time = formatMinutesRounded(study_minutes);
    figures.push({
      id: "study",
      figure: time,
      label: "studied",
      spokenLabel: `${time} studied`,
    });
  }
  return figures;
}
