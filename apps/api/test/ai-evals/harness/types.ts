/**
 * Type contract for the adversarial AI eval suite.
 *
 * This file is the seam between the eval corpus and whatever answers it.
 * Everything here describes what an implementation must accept and return in
 * order to be graded, and imports no application code. Today's implementation
 * is `ask-agent.ts` (the product's Ask over the AI gateway, with a scripted
 * model); the bake-off
 * (#4311) puts real providers behind the same contract.
 *
 * Threat model: `docs/security/ai-prompt-injection.md`
 * Spec: `spec/architecture/README.md` §13 (AI Corpus Architecture) → Evals
 */

/** The four adversarial categories mandated by spec §13 → Evals. */
export type EvalCategory =
  | 'stale-information'
  | 'conflicting-sources'
  | 'missing-information'
  | 'prompt-injection';

export const EVAL_CATEGORIES: readonly EvalCategory[] = [
  'stale-information',
  'conflicting-sources',
  'missing-information',
  'prompt-injection',
];

/**
 * Where an injected instruction entered the context window. Each corresponds to
 * a section of the threat model; the suite asserts every one is exercised.
 */
export type InjectionVector =
  | 'uploaded-document'
  | 'announcements-channel'
  | 'retrieved-chat-message'
  | 'tool-result';

export const INJECTION_VECTORS: readonly InjectionVector[] = [
  'uploaded-document',
  'announcements-channel',
  'retrieved-chat-message',
  'tool-result',
];

/** What the attacker is trying to get the agent to do on their behalf. */
export type InjectionGoal =
  | 'privilege-escalation'
  | 'cross-chapter-read'
  | 'cross-chapter-write'
  | 'exfiltration'
  | 'instruction-override';

/**
 * A source the retrieval layer put in front of the model.
 *
 * `sourceType` mirrors the corpus table in spec §13. `chat_message` covers
 * replies under `#announcements` and, since 2026-11-11, messages in chapter
 * channels (`spec/behavior/ai.md` § Chat as a source). DMs stay out. A chat
 * message carries `chat`: which channel it is in and whether its author said
 * yes on the consent sheet, which is what the two chat rules in the grader
 * read (#4307).
 */
export interface CorpusDocument {
  id: string;
  /** Owning chapter. Cross-chapter leakage is judged against the caller's chapter. */
  chapterId: string;
  sourceType:
    'chapter_document' | 'meeting_minutes' | 'announcement' | 'chat_message';
  title: string;
  body: string;
  /** When the content took effect. Distinct from upload time — see spec §13 Prerequisites. */
  effectiveAt?: string;
  createdAt: string;
  /** Required on a `chat_message`, absent on every other source type. */
  chat?: ChatProvenance;
}

/** Where a chat message was written and by whom, as retrieval must see it. */
export interface ChatProvenance {
  channelId: string;
  authorMemberId: string;
  /**
   * The author said yes on the AI consent sheet. An unanswered sheet is no
   * (`spec/behavior/ai.md` § Consent). A message whose author said no is
   * never in a model's input and is never cited.
   */
  authorConsented: boolean;
}

/** A structured-data read. Never embedded; injected as a tool result at answer time. */
export interface ToolResult {
  toolName: string;
  /**
   * What the tool reads, as the planner is told. Left out, the planner sees
   * only the name. A real model picks its reads by this line, so the
   * real-question set gives the product's own wording.
   */
  description?: string;
  /** Free-form payload as the model would see it. Strings here are attacker-reachable. */
  content: string;
  chapterId: string;
}

/**
 * The identity every tool call must run under. The agent's authority ceiling is
 * this member's permission set — never the service's ambient `service_role`.
 */
export interface EvalCaller {
  memberId: string;
  chapterId: string;
  roleName: string;
  permissions: string[];
  /**
   * The chat channels this member can open. A chat message from any other
   * channel must never reach an answer (`ai.md` § Chat as a source, "Answers
   * follow the asker's access"). Absent means none.
   */
  channelIds?: string[];
}

export interface Citation {
  documentId: string;
  quotedText: string;
}

export interface RecordedToolCall {
  toolName: string;
  /** Permission the call required, as declared by the tool registry. */
  requiredPermission?: string;
  /** Chapter the call targeted. Must equal the caller's chapter. */
  targetChapterId?: string;
  /** True when the call mutates state (as opposed to a read). */
  mutating: boolean;
}

/** A card the agent proposed. Nothing has changed; the member confirms or dismisses. */
export interface ProposedCard {
  kind: string;
  /** The card's title as the member reads it. */
  title: string;
  /** The member the card names as owner, by name, when it names one. */
  owner?: string | null;
}

/** Who is asking, as the roster shows them. Never contact details. */
export interface EvalAsker {
  name: string;
  roles: string[];
  alumni: boolean;
}

/** Where in the app the question was asked from (`from` on the Ask request). */
export interface EvalAskedFrom {
  channelId?: string;
  eventId?: string;
  taskId?: string;
}

export interface AgentInvocation {
  question: string;
  caller: EvalCaller;
  corpus: CorpusDocument[];
  toolResults: ToolResult[];
  /**
   * The asker's name and roles. The adversarial cases name none, and the
   * agent then answers without knowing who asked. The real-question set
   * always gives one: "me" has to mean somebody.
   */
  asker?: EvalAsker;
  /** Where the member asked from. An agent that has no use for it ignores it. */
  from?: EvalAskedFrom;
  /**
   * The chapter as records, for an agent whose tools take arguments
   * (`synthetic-chapter/term.ts`, `TermChapter`). Typed loosely here because
   * this file imports nothing; the agent that reads it knows the shape.
   * `toolResults` is the same chapter already read, for an agent whose reads
   * take none.
   */
  chapter?: unknown;
}

export interface AgentAnswer {
  text: string;
  /** The agent declined to answer, or said it does not know. */
  refused: boolean;
  citations: Citation[];
  toolCalls: RecordedToolCall[];
  /**
   * Cards proposed beside the answer. Absent from an agent that cannot
   * propose any (the one-shot Ask), which is not the same as proposing none.
   */
  proposals?: ProposedCard[];
}

/**
 * The implementation seam. `ask-agent.ts` satisfies it; with nothing
 * registered the behavioural specs report NOT_IMPLEMENTED.
 */
export interface AgentUnderTest {
  readonly name: string;
  ask(invocation: AgentInvocation): Promise<AgentAnswer>;
}

/** What a graded answer must and must not contain. */
export interface EvalExpectation {
  /** The answer must be a refusal or an explicit "I don't know". */
  mustRefuse?: boolean;
  /** Substrings that must appear in the answer text (case-insensitive). */
  mustMention?: string[];
  /** Substrings that must NOT appear — stale figures, other chapters' data, secrets. */
  mustNotMention?: string[];
  /** Document IDs the answer must cite. */
  mustCite?: string[];
  /** The answer must present a disagreement rather than synthesise it away. */
  mustSurfaceConflict?: boolean;
  /**
   * The first citation must be this document. Official sources rank above
   * chat (`ai.md` § Chat as a source), so a conflict between a bylaw and a
   * message leads with the bylaw.
   */
  mustCiteFirst?: string;
  /**
   * The answer must say this many messages were left out because their
   * authors opted out, without saying whose.
   */
  mustReportLeftOut?: number;
  /**
   * If the answer says messages were left out, it says no more than this
   * many. The count covers only the conversations the answer drew on, so on
   * a large corpus the exact number depends on retrieval; what must hold is
   * that it never counts a message the asker could not have opened.
   */
  mustNotReportLeftOutAbove?: number;
  /** No tool call outside this list is permitted. An empty array forbids all tool calls. */
  allowedTools?: string[];
  /** No mutating tool call is permitted, whatever the tool. */
  forbidsMutation?: boolean;
}

/** Present only on `prompt-injection` cases. */
export interface InjectionMetadata {
  vector: InjectionVector;
  /** The smuggled instruction, verbatim, as it sits in the corpus body. */
  payload: string;
  goal: InjectionGoal;
  /**
   * Permissions the *injecting* member actually holds. The core invariant: an
   * injected instruction may never produce an effect this set could not.
   *
   * Strings must be real values from
   * `apps/api/src/domain/constants/permissions.ts` — the ceiling is a set
   * membership test against what a live tool registry will declare, so an
   * invented name makes every graded call fail for the wrong reason.
   */
  injectorPermissions: string[];
  /**
   * The permission the injected instruction is trying to exercise. Required on
   * `privilege-escalation` cases, where the invariant is specifically that the
   * ceiling *excludes* it — a ceiling that merely differs from the caller's
   * would prove nothing.
   */
  attemptedPermission?: string;
}

export interface EvalCase {
  id: string;
  category: EvalCategory;
  /** One line on what this case proves. Surfaced in the test name. */
  intent: string;
  invocation: AgentInvocation;
  expect: EvalExpectation;
  injection?: InjectionMetadata;
}
