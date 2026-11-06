/**
 * Reports each caught render error once, however many times its fallback
 * remounts (#3378). Web's `SegmentError` and mobile's route boundaries both
 * report through one of these, so the rule can't drift between the apps.
 *
 * A boundary's fallback remounts on every reset, and React may render it more
 * than once for one error, so a report keyed on the mount repeats. This keys it
 * on the error object instead: one object, one event. Being weak, the set holds
 * nothing alive.
 *
 * A thrown non-object (a string, `undefined`) can't be a `WeakSet` key, so it
 * is reported every time. Those are rare enough that the duplicate is cheaper
 * than the bookkeeping to dedupe them.
 */
export function createReportOnce<Context>(
  capture: (error: unknown, context: Context) => void,
): (error: unknown, context: Context) => void {
  const reported = new WeakSet<object>();
  return (error, context) => {
    if (typeof error === "object" && error !== null) {
      if (reported.has(error)) return;
      reported.add(error);
    }
    capture(error, context);
  };
}
