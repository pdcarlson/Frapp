import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { CHAPTER_AGENT_TOOLS } from '../src/application/services/ask/agent/tools-chapter';
import { ChapterAgentToolsModule } from '../src/modules/ask/chapter-agent-tools.module';

/**
 * `ChapterAgentToolsModule` (#4901) is imported by nothing until the core
 * slice of the agent build wires it into `AskModule` (#4899), so nothing
 * else would notice a tool whose service its module cannot provide. This
 * builds it beside the real application and takes each tool out of it.
 */
describe('ChapterAgentToolsModule (e2e)', () => {
  it('provides every chapter tool with the services it reads through', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ChapterAgentToolsModule],
    })
      .overrideProvider('SUPABASE_CLIENT')
      .useValue({ auth: { getUser: jest.fn() }, from: jest.fn() })
      .compile();

    const tools = CHAPTER_AGENT_TOOLS.map((Tool) =>
      moduleRef.get(Tool, { strict: false }),
    );
    expect(tools.map((tool) => tool.name)).toEqual([
      'find_member',
      'roster',
      'my_tasks',
      'chapter_tasks',
      'events',
      'open_event',
      'my_attendance',
      'event_attendance',
      'attendance_summary',
      'my_standing',
      'my_points',
      'points_standings',
      'my_hours',
      'service_hours',
      'my_dues',
    ]);
    await moduleRef.close();
  });
});
