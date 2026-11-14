import { AttendanceSummaryAgentTool } from './attendance-summary.tool';
import { ChapterTasksAgentTool } from './chapter-tasks.tool';
import { EventAttendanceAgentTool } from './event-attendance.tool';
import { EventsAgentTool } from './events.tool';
import { FindMemberAgentTool } from './find-member.tool';
import { MyAttendanceAgentTool } from './my-attendance.tool';
import { MyDuesAgentTool } from './my-dues.tool';
import { MyHoursAgentTool } from './my-hours.tool';
import { MyPointsAgentTool } from './my-points.tool';
import { MyStandingAgentTool } from './my-standing.tool';
import { MyTasksAgentTool } from './my-tasks.tool';
import { OpenEventAgentTool } from './open-event.tool';
import { PointsStandingsAgentTool } from './points-standings.tool';
import { RosterAgentTool } from './roster.tool';
import { ServiceHoursAgentTool } from './service-hours.tool';

/**
 * The tools that read the chapter's people, tasks, events and standing for
 * Ask's agent loop (#4901, epic #4898), in the order a model reads them.
 *
 * `ChapterAgentToolsModule` provides exactly these classes, and
 * `chapter-agent-tools.spec.ts` holds each one to the rules a tool keeps
 * (`../agent-tool.ts`), so a tool added here is checked without a second
 * list to remember. `AskModule` lists them under `AGENT_READ_TOOLS`, which
 * is what the loop may call.
 *
 * What the six one-shot reads in `../../ask-tools.ts` answered, these answer
 * too: `roster`, `events`, `my_points`, `points_leaderboard` (here
 * `points_standings`), `my_dues` and `my_tasks`.
 */
export const CHAPTER_AGENT_TOOLS = [
  FindMemberAgentTool,
  RosterAgentTool,
  MyTasksAgentTool,
  ChapterTasksAgentTool,
  EventsAgentTool,
  OpenEventAgentTool,
  MyAttendanceAgentTool,
  EventAttendanceAgentTool,
  AttendanceSummaryAgentTool,
  MyStandingAgentTool,
  MyPointsAgentTool,
  PointsStandingsAgentTool,
  MyHoursAgentTool,
  ServiceHoursAgentTool,
  MyDuesAgentTool,
] as const;
