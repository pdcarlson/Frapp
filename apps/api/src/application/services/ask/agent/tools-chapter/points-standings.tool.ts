import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { MemberService } from '../../../member.service';
import { PointsService } from '../../../points.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  count,
  fitRows,
  found,
  listSourceId,
  liveSource,
  nothing,
  People,
} from './chapter-tool-kit';

const DEFAULT_PLACES = 25;
const MAX_PLACES = 150;

const PERIOD_WORDS = {
  semester: 'this semester',
  month: 'this month',
  all: 'all time',
} as const;

const input = z.object({
  period: z
    .enum(['semester', 'month', 'all'])
    .default('semester')
    .describe('Standings for this semester, this month, or all time.'),
  places: z
    .number()
    .int()
    .min(1)
    .max(MAX_PLACES)
    .default(DEFAULT_PLACES)
    .describe(
      `How many places to list from the top, up to ${MAX_PLACES}. The asking member's own place is always given.`,
    ),
});
type Args = z.infer<typeof input>;

/**
 * The points standings every member sees: `GET /v1/points/leaderboard`.
 * Where the asker stands, the average and how far they are from the top are
 * worked out here.
 */
@Injectable()
export class PointsStandingsAgentTool implements AgentReadTool<Args> {
  readonly name = 'points_standings';
  readonly description =
    "The chapter's points standings for a period: who has the most points, each member's place, the asking member's own place and how far they are behind the member above them, and the chapter's total and average.";
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'points';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Reading the points standings';

  constructor(
    private readonly points: PointsService,
    private readonly members: MemberService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId } = context;
    const [board, roster] = await Promise.all([
      this.points.getLeaderboard(chapterId, args.period),
      this.members.findRosterByChapter(chapterId),
    ]);
    if (board.length === 0) {
      return nothing(context, 'Nobody is on the points standings yet.');
    }
    const people = new People(roster);
    const words = PERIOD_WORDS[args.period];
    // Ranked as the Points page ranks (`spec/behavior/points.md`
    // § Leaderboard): equal totals share a place (1, 1, 3), and a member who
    // has left keeps their row, so nobody below them moves up.
    let place = 0;
    const ranked = board.map((row, index) => {
      if (index === 0 || row.total !== board[index - 1].total) {
        place = index + 1;
      }
      return { ...row, place };
    });
    const total = ranked.reduce((sum, row) => sum + row.total, 0);
    const mine = ranked.find((row) => row.user_id === userId);
    const above = mine
      ? [...ranked].reverse().find((row) => row.total > mine.total)
      : undefined;
    const summary = [
      `Members on the standings ${words}: ${ranked.length}.`,
      `Points earned by the whole chapter ${words}: ${total}.`,
      `Average per member ${words}: ${Math.round(total / ranked.length)} points.`,
      mine
        ? `You are in place ${mine.place} of ${ranked.length} with ${mine.total} points ${words}.`
        : `You are not on the standings ${words}.`,
      ...(mine && above
        ? [
            `You are ${count(above.total - mine.total, 'point')} behind place ${above.place}.`,
          ]
        : []),
    ];
    const rows = ranked.map(
      (row) =>
        `Place ${row.place}: ${people.name(row.user_id)}, ${row.total} points ${words}.`,
    );
    const shown = fitRows(summary, rows, args.places);
    const cut = rows.length - shown.length;
    const cutLine =
      cut > 0
        ? `${count(cut, 'more member')} below these not listed here.`
        : null;
    return found(
      context,
      liveSource({
        id: listSourceId(this.name, args.period, args.places),
        kind: 'points',
        title: 'Points standings',
        page: 'points',
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      people,
      cutLine
        ? `Showing the top ${shown.length} of ${rows.length}. Ask for more places to see further down.`
        : null,
    );
  }
}
