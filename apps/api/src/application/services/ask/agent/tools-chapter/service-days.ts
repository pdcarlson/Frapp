import { localDateIn } from '#domain/utils/zoned-time';
import type { AgentToolContext } from '../agent-tool';
import { readWindow } from './chapter-tool-kit';

const BACK_DAYS = 120;
const MAX_DAYS = 366;

/**
 * The calendar days a service read covers. Service is logged by the day it
 * was done (a date, not an instant), so the range is two days as the asker
 * names them, never longer than a year.
 */
export function serviceDays(
  args: { from: string; to: string },
  context: AgentToolContext,
  backDays = BACK_DAYS,
): { from: string; to: string; shortened: boolean } {
  const window = readWindow(args, context, {
    backDays,
    aheadDays: 0,
    maxDays: MAX_DAYS,
  });
  return {
    from: localDateIn(window.start, context.timeZone),
    // The window's end is exclusive: the last day read is the one before.
    to: localDateIn(new Date(window.end.getTime() - 1), context.timeZone),
    shortened: window.shortened,
  };
}
