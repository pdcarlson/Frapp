import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { PointsService } from '../../../points.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  fitRows,
  found,
  listSourceId,
  liveSource,
  longDay,
  quoted,
} from './chapter-tool-kit';

const TRANSACTIONS_LIMIT = 25;

const PERIOD_WORDS = {
  semester: 'this semester',
  month: 'this month',
  all: 'all time',
} as const;

const CATEGORY_WORDS: Record<string, string> = {
  ATTENDANCE: 'attendance',
  ACADEMIC: 'academics',
  SERVICE: 'service',
  FINE: 'fines',
  MANUAL: 'adjustments by an officer',
  STUDY: 'study',
};

const input = z.object({
  period: z
    .enum(['semester', 'month', 'all'])
    .default('semester')
    .describe(
      'Which point changes to list and add up: this semester, this month, or all time.',
    ),
});
type Args = z.infer<typeof input>;

/** The asker's own points: `GET /v1/points/me`, with the totals by kind added up. */
@Injectable()
export class MyPointsAgentTool implements AgentReadTool<Args> {
  readonly name = 'my_points';
  readonly description =
    "The asking member's own points: their totals this semester and all time, how many came from attendance, service, study and the rest in a period, and their latest point changes with the reason for each.";
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'points';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Reading your points';

  constructor(private readonly points: PointsService) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, timeZone } = context;
    const [all, semester, month] = await Promise.all([
      this.points.getUserSummary(chapterId, userId, 'all'),
      this.points.getUserSummary(chapterId, userId, 'semester'),
      args.period === 'month'
        ? this.points.getUserSummary(chapterId, userId, 'month')
        : Promise.resolve(null),
    ]);
    const period = month ?? (args.period === 'all' ? all : semester);
    const words = PERIOD_WORDS[args.period];
    const byCategory = new Map<string, number>();
    for (const txn of period.transactions) {
      byCategory.set(
        txn.category,
        (byCategory.get(txn.category) ?? 0) + txn.amount,
      );
    }
    const summary = [
      `Your points this semester: ${semester.balance}.`,
      `Your points all time: ${all.balance}.`,
      ...(args.period === 'month'
        ? [`Your points this month: ${period.balance}.`]
        : []),
      ...[...byCategory]
        .sort(([, a], [, b]) => b - a)
        .map(
          ([category, total]) =>
            `From ${CATEGORY_WORDS[category] ?? category.toLowerCase()} ${words}: ${total} points.`,
        ),
      `Point changes ${words}: ${period.transactions.length}.`,
    ];
    const rows = [...period.transactions]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(
        (txn) =>
          `${longDay(txn.created_at, timeZone)}: ${txn.amount > 0 ? '+' : ''}${txn.amount} points for ${CATEGORY_WORDS[txn.category] ?? txn.category.toLowerCase()}${txn.description ? `, ${quoted(txn.description)}` : ''}.`,
      );
    const shown = fitRows(summary, rows, TRANSACTIONS_LIMIT);
    const cut = rows.length - shown.length;
    const cutLine =
      cut > 0
        ? `${cut} earlier point changes not listed here. The totals above include them.`
        : null;
    return found(
      context,
      liveSource({
        id: listSourceId(this.name, args.period),
        kind: 'points',
        title: 'Your points',
        page: 'points',
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      null,
      cutLine
        ? `Showing the newest ${shown.length} of ${rows.length} point changes.`
        : null,
    );
  }
}
