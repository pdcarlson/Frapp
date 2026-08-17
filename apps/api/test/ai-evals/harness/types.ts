/**
 * Type contract for the adversarial AI eval suite.
 *
 * This file is the seam between the eval corpus (which exists today) and the AI
 * agent (which does not — see FRA-309 / FRA-310). Everything here describes what
 * an implementation must accept and return in order to be graded; nothing here
 * imports application code, so the suite compiles and runs against an empty repo.
 *
 * Threat model: `docs/internal/security/ai-prompt-injection.md`
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
 * `sourceType` mirrors the corpus table in spec §13. Note that `chat_message`
 * is only ever `#announcements` or an explicitly retrieved message — casual
 * chat and DMs are out of corpus per `spec/behavior/ai.md` non-goals.
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
}

/** A structured-data read. Never embedded; injected as a tool result at answer time. */
export interface ToolResult {
  toolName: string;
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

export interface AgentInvocation {
  question: string;
  caller: EvalCaller;
  corpus: CorpusDocument[];
  toolResults: ToolResult[];
}

export interface AgentAnswer {
  text: string;
  /** The agent declined to answer, or said it does not know. */
  refused: boolean;
  citations: Citation[];
  toolCalls: RecordedToolCall[];
}

/**
 * The implementation seam. FRA-309 / FRA-310 satisfy this; until then the
 * registry holds `null` and the behavioural specs report NOT_IMPLEMENTED.
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
