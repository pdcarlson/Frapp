import {
  ASK_STEP_NAMES_MAX,
  askStepKind,
  type AskStreamEvent,
} from '@repo/validation';
import type { AgentLoopEvent } from './agent-loop.service';
import type { AgentSource } from './agent-tool';

type AgentRead = Extract<AgentLoopEvent, { type: 'read' }>;
type AskStepEvent = Omit<Extract<AskStreamEvent, { type: 'step' }>, 'v'>;

/**
 * The stream's `step` for a read that ended (#5427, `spec/behavior/ai.md`
 * § Ask Frapp): how it went, how many things it returned and up to
 * `ASK_STEP_NAMES_MAX` of their names, so the member sees what each read
 * found as it lands.
 *
 * Only what the turn already shows a member is named: a source's chip title
 * (`source.title`, the bare name the answer's own chips show, never the
 * model-facing `agentSourceTitle` with its labels, dates and headings), from
 * what the read returned as the asker, so each is something they can open. Chat sources are already
 * past the consent filter, and their channel is named, never an author or a
 * line of text. No argument the model wrote and no source text is sent.
 */
export function askStepEnded(read: AgentRead): AskStepEvent {
  const ok = read.outcome === 'ok';
  const sources = ok ? read.sources : [];
  const names = [
    ...new Set(
      sources.map((source: AgentSource) => source.title).filter(Boolean),
    ),
  ];
  // A message is one thing found; a document's passages are one document.
  const chat = sources.length > 0 && sources.every((source) => source.chat);
  const found = chat ? sources.length : names.length;
  return {
    type: 'step',
    call: read.call,
    tool: read.name,
    kind: askStepKind(read.name),
    outcome: !ok ? 'failed' : found > 0 ? 'found' : 'nothing',
    found,
    names: names.slice(0, ASK_STEP_NAMES_MAX),
  };
}
