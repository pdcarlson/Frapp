/**
 * The trace of an Ask turn and the asker's thumbs on its answer (#4902,
 * `spec/behavior/ai.md` § Stored AI text). Ids, codes and counts only: no
 * row here has a field that can hold a question, an answer, a tool's
 * arguments or a tool's result, and the migration's checks hold every text
 * column to a code (`20261113203728_ai_ask_traces_and_feedback.sql`).
 */

/** A row of `ai_ask_traces`: one turn. */
export interface AskTraceRow {
  /** The ask's own id, the one the stream's `start` event carries. */
  id: string;
  chapter_id: string;
  /** The asker's membership row. Deleting it deletes the trace. */
  member_id: string;
  user_id: string;
  door: string;
  prompt_version: string;
  model: string;
  effort: string;
  outcome: string;
  limit_kind: string | null;
  error_kind: string | null;
  is_follow_up: boolean;
  /** The same member asked again within a minute of their last question. */
  is_rephrase: boolean;
  read_chat: boolean;
  truncated: boolean;
  rounds: number;
  tool_calls: number;
  tool_failures: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_micro_usd: number;
  duration_ms: number;
  sources_read: number;
  citations_kept: number;
  citations_dropped: number;
  left_out_messages: number;
  proposals: number;
  started_at: string;
  /** At most 90 days after `started_at`; the sweep deletes the row then. */
  expires_at: string;
}

/** A row of `ai_ask_trace_steps`: one model round or one tool call. */
export interface AskTraceStepRow {
  trace_id: string;
  seq: number;
  round: number;
  kind: string;
  /** A tool's registered name; null on a model round or an unknown tool. */
  tool: string | null;
  outcome: string;
  duration_ms: number;
  arg_bytes: number;
  result_chars: number;
  result_sources: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_micro_usd: number;
}

/** A row of `ai_ask_feedback`: the asker's thumbs on one answer. */
export interface AskFeedbackRow {
  ask_id: string;
  chapter_id: string;
  user_id: string;
  rating: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
}
