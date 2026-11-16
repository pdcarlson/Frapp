import {
  AI_CONSENT_SHEET,
  type AiConsentSheetDataKind,
} from '#domain/constants/ai-consent-sheet';
import { ASK_TOOL_CLASSES } from './ask-tools';
import { CHAPTER_AGENT_TOOLS } from './agent/tools-chapter';
import { CONVERSATION_AGENT_TOOLS } from './agent/tools-conversations';

type Row = AiConsentSheetDataKind['key'];

/**
 * Which rows of the AI sheet name the data each Ask tool puts in front of the
 * model (#4787). Every tool Ask can run is listed here by class, so a tool
 * added to any of the three lists fails below until someone decides which row
 * covers it. Data no row's label names needs the label widened or a new row
 * (`ai-consent-sheet.ts` says when that is a new version), and the privacy
 * policy's Frapp AI section changes with it.
 */
const TOOL_ROWS: Record<string, readonly Row[]> = {
  // The one-shot reads (`ask-tools.ts`).
  RosterAskTool: ['roster'],
  EventsAskTool: ['chapter_records'],
  MyPointsAskTool: ['roster'],
  PointsLeaderboardAskTool: ['roster'],
  MyDuesAskTool: ['roster'],
  MyTasksAskTool: ['chapter_records'],
  // People, tasks, events and standing (`agent/tools-chapter`).
  FindMemberAgentTool: ['roster'],
  RosterAgentTool: ['roster'],
  MyTasksAgentTool: ['chapter_records'],
  ChapterTasksAgentTool: ['chapter_records'],
  EventsAgentTool: ['chapter_records'],
  OpenEventAgentTool: ['chapter_records'],
  MyAttendanceAgentTool: ['roster'],
  EventAttendanceAgentTool: ['roster', 'chapter_records'],
  AttendanceSummaryAgentTool: ['roster'],
  MyStandingAgentTool: ['roster'],
  MyPointsAgentTool: ['roster'],
  PointsStandingsAgentTool: ['roster'],
  MyHoursAgentTool: ['roster'],
  ServiceHoursAgentTool: ['roster'],
  MyDuesAgentTool: ['roster'],
  // Conversations and records (`agent/tools-conversations`).
  SearchMessagesTool: ['channel_messages'],
  ReadChannelTool: ['channel_messages'],
  ListChannelsTool: ['channel_messages'],
  SearchRecordsTool: ['chapter_records', 'meetings'],
  ReadMinutesTool: ['meetings'],
  ReadDocumentTool: ['chapter_records'],
  ListMeetingsTool: ['meetings'],
};

const ALL_TOOLS = [
  ...ASK_TOOL_CLASSES,
  ...CHAPTER_AGENT_TOOLS,
  ...CONVERSATION_AGENT_TOOLS,
];

describe('Every Ask tool is covered by the AI sheet', () => {
  const rows = new Set<string>(AI_CONSENT_SHEET.data.map((d) => d.key));

  it.each(ALL_TOOLS.map((tool) => [tool.name]))(
    '%s maps to rows the sheet names',
    (name) => {
      const covered = TOOL_ROWS[name];
      // Unmapped: decide which row names this tool's data, or bump the sheet.
      expect(covered).toBeDefined();
      for (const row of covered) expect(rows).toContain(row);
    },
  );

  it('lists no tool that no longer exists', () => {
    const names = new Set(ALL_TOOLS.map((tool) => tool.name));
    for (const name of Object.keys(TOOL_ROWS)) expect(names).toContain(name);
  });
});
