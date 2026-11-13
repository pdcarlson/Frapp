import { Module } from '@nestjs/common';
import { ChatChannelReadsService } from '../../application/services/chat-channel-reads.service';
import {
  CONVERSATION_AGENT_TOOLS,
  CONVERSATION_AGENT_TOOL_HELPERS,
} from '../../application/services/ask/agent/tools-conversations';
import { ChatCatchUpModule } from '../chat-catch-up/chat-catch-up.module';
import { ChatModule } from '../chat/chat.module';
import { CorpusModule } from '../corpus/corpus.module';
import { MeetingModule } from '../meeting/meeting.module';
import { MemberModule } from '../member/member.module';
import { SearchModule } from '../search/search.module';

/**
 * Ask's agent tools for conversations and records (#4900, epic #4898):
 * `search_messages`, `read_channel`, `list_channels`, `search_records`,
 * `read_minutes`, `read_document` and `list_meetings`.
 *
 * It provides and exports the tool classes of `CONVERSATION_AGENT_TOOLS`
 * and nothing else: no route, no table, no worker. The agent loop's module
 * imports this one and lists the classes under `AGENT_READ_TOOLS`
 * (`application/services/ask/agent/agent-tool.ts`). Until it does, no tool
 * here can be called by anything.
 *
 * Each import is the module of a service a tool reads through, the same
 * service the mirrored route calls.
 */
@Module({
  imports: [
    // `ChatService`, held only through `ChatChannelReadsService`: the
    // member's channel list and unread counts.
    ChatModule,
    // `ChatCatchUpService.readStretch`: the one reader of chat for a model.
    ChatCatchUpModule,
    // `SearchService`: the app's message search.
    SearchModule,
    // `CorpusRetrievalService`: the index of documents, minutes and chat.
    CorpusModule,
    // `MeetingService`: who may read which minutes.
    MeetingModule,
    // `MemberService`: the roster, for a name the model wrote.
    MemberModule,
  ],
  providers: [
    ChatChannelReadsService,
    ...CONVERSATION_AGENT_TOOL_HELPERS,
    ...CONVERSATION_AGENT_TOOLS,
  ],
  exports: [...CONVERSATION_AGENT_TOOLS],
})
export class AskConversationToolsModule {}
