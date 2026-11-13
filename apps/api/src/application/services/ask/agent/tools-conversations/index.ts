import { ConversationScope } from './conversation-scope';
import { ListChannelsTool } from './list-channels.tool';
import { ListMeetingsTool } from './list-meetings.tool';
import { ReadChannelTool } from './read-channel.tool';
import { ReadDocumentTool } from './read-document.tool';
import { ReadMinutesTool } from './read-minutes.tool';
import { SearchMessagesTool } from './search-messages.tool';
import { SearchRecordsTool } from './search-records.tool';

/**
 * The agent tools that read conversations and records (#4900, epic #4898):
 * channel messages, and the chapter's documents and minutes. Each is an
 * `AgentReadTool` (`../agent-tool.ts`), and `conversation-tools.spec.ts`
 * holds every class in this list to the rules a tool keeps, so a tool added
 * here is checked without a second list to remember.
 *
 * The order is the order a model is shown them: finding before reading.
 *
 * `AskConversationToolsModule` (`modules/ask-conversation-tools`) provides
 * and exports these classes. The agent loop's module imports it and lists
 * them under `AGENT_READ_TOOLS`; nothing calls a tool until it does.
 */
export const CONVERSATION_AGENT_TOOLS = [
  SearchMessagesTool,
  ReadChannelTool,
  ListChannelsTool,
  SearchRecordsTool,
  ReadMinutesTool,
  ReadDocumentTool,
  ListMeetingsTool,
] as const;

/** What the tools need beside the services they read through. */
export const CONVERSATION_AGENT_TOOL_HELPERS = [ConversationScope] as const;

export {
  ConversationScope,
  ListChannelsTool,
  ListMeetingsTool,
  ReadChannelTool,
  ReadDocumentTool,
  ReadMinutesTool,
  SearchMessagesTool,
  SearchRecordsTool,
};
