import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

/**
 * The chat read-surface ledger (#2257, #2324): every surface that can put one
 * member's chat content in front of another, and what each does about the
 * viewer's block list.
 *
 * `spec/behavior/chat/README.md` § Report and block says what a block hides.
 * That promise is only as good as the least-covered surface, and surfaces are
 * added one at a time by people thinking about something else. The first build
 * of the block mask covered two read surfaces out of about six, with every test
 * green, because each test proved the surface it was written for and nothing
 * enumerated the rest. So this file **enumerates, and fails on anything it
 * enumerates that is unclassified**:
 *
 * - every operation `openapi.json` gives one of `CHAT_CONTROLLERS`. Three reads
 *   on other controllers serve chat content too (search, the activity feed,
 *   the notification list) and are listed by hand, so a chat read added to
 *   some other controller is the one case this does not catch;
 * - every policy any migration creates that can read, which is how a client
 *   reads around the API entirely (PostgREST and the Realtime
 *   `postgres_changes` echo), with RLS pinned on for every public table so a
 *   table cannot be read with no policy at all, and with no storage policy
 *   anywhere;
 * - every notify-named call in the API, counted per file, and every Realtime
 *   `postgres_changes` subscription the API opens, since that is how a new
 *   push gets built.
 *
 * What it cannot see, so nobody reads a green run as more than it is:
 * - a chat read added to a controller outside `CHAT_CONTROLLERS`;
 * - an existing notification edited to carry another member's words, since
 *   the per-file count does not move, and a notification sent through a
 *   wrapper whose name does not contain `notify`;
 * - a `postgres_changes` subscription whose event is not a single literal (or
 *   the enum member) in `apps/api/src`: concatenated, built at runtime, passed
 *   in as a parameter or config value, or held in a constant declared outside
 *   it, or a subscription opened by a helper outside it;
 * - Broadcast and Presence subscriptions, which this does not scan. The push
 *   worker reads Presence on `chat:channel:<id>`; what those topics may carry
 *   is the `realtime.messages` entry below (#2496);
 * - member text re-posted under the system actor, which cannot be blocked. The
 *   poll-expiry notice quotes the poll's question this way (#2495);
 * - a policy or table written through dynamic SQL assembled from parts.
 *
 * A `masked` entry names the test that proves it, and that test must be live:
 * present, not commented out, in a spec that skips and focuses nothing. A
 * policy's proof can instead be a scenario in the PGlite harness, which reads
 * the table as a non-owner role and is the only tier that runs RLS; it must
 * still be a `name:` in that file. That cannot prove the test asserts the
 * right thing, but it stops a renamed, deleted or disabled proof leaving the
 * ledger vouching for nothing. An `open` entry is a known gap, and names the
 * issue tracking it; one that is masked in part also names the proof of that
 * part, checked the same way. The ledger's job is to keep gaps visible, not
 * to pretend there are none.
 */

/**
 * A Jest test (`spec` relative to `apps/api/src`, `test` its title), or a
 * scenario `name` in `scripts/check-pglite-migrations.mjs`.
 */
type Proof = { spec: string; test: string } | { pglite: string };

type Entry =
  | { status: 'masked'; proof: Proof }
  /** Serves nothing another member authored: metadata, counts, or the caller's own writes. */
  | { status: 'no-foreign-content'; why: string }
  /** Serves another member's content on purpose. The spec's table says so. */
  | { status: 'not-hidden'; why: string }
  /**
   * A known gap, tracked. `proof`, when the surface is masked in part: the
   * test for the part that is, held live like a `masked` entry's.
   */
  | { status: 'open'; issues: number[]; why: string; proof?: Proof };

const API_SRC = join(__dirname, '..', '..');
const API_ROOT = join(API_SRC, '..');
const MIGRATIONS = join(API_ROOT, '..', '..', 'supabase', 'migrations');
const PGLITE_HARNESS = join(
  API_ROOT,
  '..',
  '..',
  'scripts',
  'check-pglite-migrations.mjs',
);

const CHAT_SERVICE_SPEC = 'application/services/chat.service.spec.ts';

const OWN_PREFERENCES: Entry = {
  status: 'no-foreign-content',
  why: "The caller's own notification preferences.",
};
const CHANNEL_METADATA: Entry = {
  status: 'no-foreign-content',
  why: 'Channel or category metadata; no message content. Membership is not hidden by a block (the Directory row), and refusing a DM because of one would be an oracle.',
};
const OFFICER_MODERATION: Entry = {
  status: 'not-hidden',
  why: '`channels:manage` moderation. "A personal block must not blind an officer acting in their role."',
};

/**
 * Controllers whose every operation is ledgered. A new route on any of them
 * fails `every operation is classified` until it is added below.
 */
const CHAT_CONTROLLERS = [
  'ChatController',
  'ChatBookmarkController',
  'ChatReportController',
  'ChatBlockController',
  'PollController',
];

const HTTP_LEDGER: Record<string, Entry> = {
  // ── Channels and categories ────────────────────────────────────────
  ChatController_listChannels_v1: CHANNEL_METADATA,
  ChatController_createChannel_v1: CHANNEL_METADATA,
  ChatController_getChannel_v1: CHANNEL_METADATA,
  ChatController_updateChannel_v1: CHANNEL_METADATA,
  ChatController_deleteChannel_v1: CHANNEL_METADATA,
  ChatController_getOrCreateDm_v1: CHANNEL_METADATA,
  ChatController_createGroupDm_v1: CHANNEL_METADATA,
  ChatController_leaveGroupDm_v1: CHANNEL_METADATA,
  ChatController_listCategories_v1: CHANNEL_METADATA,
  ChatController_createCategory_v1: CHANNEL_METADATA,
  ChatController_updateCategory_v1: CHANNEL_METADATA,
  ChatController_deleteCategory_v1: CHANNEL_METADATA,
  ChatController_getUnreadCounts_v1: {
    status: 'open',
    issues: [2521],
    why: "Counts only, but `get_channel_unread_counts` counts a blocked member's messages and @-mentions, so they still move the blocker's unread, mention and app-icon badges.",
  },
  ChatController_markRead_v1: {
    status: 'no-foreign-content',
    why: "Stamps the caller's own read cursor.",
  },

  // ── Preferences ────────────────────────────────────────────────────
  ChatController_getChannelNotificationPreferences_v1: OWN_PREFERENCES,
  ChatController_setChannelNotificationLevel_v1: OWN_PREFERENCES,
  ChatController_getKindNotificationPreferences_v1: OWN_PREFERENCES,
  ChatController_setKindNotificationLevel_v1: OWN_PREFERENCES,
  ChatController_clearKindNotificationLevel_v1: OWN_PREFERENCES,

  // ── Messages ───────────────────────────────────────────────────────
  ChatController_getMessages_v1: {
    status: 'masked',
    proof: {
      spec: CHAT_SERVICE_SPEC,
      test: 'masks messages from a member the caller has blocked',
    },
  },
  ChatController_getPinnedMessages_v1: {
    status: 'masked',
    proof: {
      spec: CHAT_SERVICE_SPEC,
      test: 'masks the pinned list too, which is channel content and not an officer surface',
    },
  },
  ChatController_listMessageAttachments_v1: {
    status: 'masked',
    proof: {
      spec: CHAT_SERVICE_SPEC,
      test: 'refuses to hand out URLs for a message whose sender the caller has blocked',
    },
  },
  ChatController_resolveAuthorAvatars_v1: {
    status: 'not-hidden',
    why: 'Imported archive authors only (`sender_id: null`). Blocks are keyed on `users.id`, so there is nobody to have blocked.',
  },
  ChatController_sendMessage_v1: {
    status: 'no-foreign-content',
    why: "Returns the caller's own message.",
  },
  ChatController_editMessage_v1: {
    status: 'no-foreign-content',
    why: "Sender-only; returns the edited message, which is the caller's own.",
  },
  ChatController_deleteMessage_v1: {
    status: 'no-foreign-content',
    why: 'Returns the soft-deleted row, whose content is already `[message deleted]`.',
  },
  ChatController_pinMessage_v1: OFFICER_MODERATION,
  ChatController_unpinMessage_v1: OFFICER_MODERATION,
  ChatController_requestUploadUrl_v1: {
    status: 'no-foreign-content',
    why: "A signed URL for the caller's own upload.",
  },

  // ── Reactions ──────────────────────────────────────────────────────
  //
  // These are the API's reaction routes. The reaction chips both clients
  // render come from `chat_message_actions`, read directly. That surface is in
  // DIRECT_READ_LEDGER below, masked at its policy.
  ChatController_recordMessageAction_v1: {
    status: 'no-foreign-content',
    why: "Returns the caller's own action row.",
  },
  ChatController_toggleReaction_v1: {
    status: 'no-foreign-content',
    why: "Returns the caller's own reaction. Legacy `message_reactions`, retired by #879.",
  },
  ChatController_getReactions_v1: {
    status: 'masked',
    proof: {
      spec: CHAT_SERVICE_SPEC,
      test: 'drops the reactions of a member the caller has blocked',
    },
  },

  // ── Bookmarks ──────────────────────────────────────────────────────
  ChatBookmarkController_listBookmarks_v1: {
    status: 'masked',
    proof: {
      spec: 'application/services/chat-bookmark.service.spec.ts',
      test: 'masks a bookmarked message whose sender the caller has blocked',
    },
  },
  ChatBookmarkController_bookmarkMessage_v1: {
    status: 'no-foreign-content',
    why: 'Returns the bookmark reference (ids), not the message.',
  },
  ChatBookmarkController_unbookmarkMessage_v1: {
    status: 'no-foreign-content',
    why: 'Returns nothing.',
  },

  // ── Reports ────────────────────────────────────────────────────────
  ChatReportController_fileReport_v1: {
    status: 'not-hidden',
    why: "Returns the caller's own report, whose evidence is a message they were authorized to read and chose to report.",
  },
  ChatReportController_listReports_v1: {
    status: 'not-hidden',
    why: 'The officer queue. "A `channels:manage` holder reviewing a report sees the content as filed."',
  },
  ChatReportController_resolveReport_v1: OFFICER_MODERATION,
  ChatReportController_removeReportedMessage_v1: OFFICER_MODERATION,

  // ── Blocks ─────────────────────────────────────────────────────────
  ChatBlockController_listBlocks_v1: {
    status: 'no-foreign-content',
    why: "The caller's own block list.",
  },
  ChatBlockController_blockMember_v1: {
    status: 'no-foreign-content',
    why: 'Returns the block reference.',
  },
  ChatBlockController_unblockMember_v1: {
    status: 'no-foreign-content',
    why: 'Returns nothing.',
  },

  // ── Polls ──────────────────────────────────────────────────────────
  PollController_createPoll_v1: {
    status: 'no-foreign-content',
    why: "Returns the caller's own poll.",
  },
  PollController_vote_v1: {
    status: 'no-foreign-content',
    why: 'Returns nothing.',
  },
  PollController_removeVote_v1: {
    status: 'no-foreign-content',
    why: 'Returns nothing.',
  },
  PollController_close_v1: {
    status: 'no-foreign-content',
    why: "Creator-only; returns the caller's own poll.",
  },
  PollController_listPolls_v1: {
    status: 'open',
    issues: [2495],
    why: "Serves a blocked member's poll question and options.",
  },
  PollController_getPoll_v1: {
    status: 'open',
    issues: [2495],
    why: "Serves a blocked member's poll question and options.",
  },

  // ── Cross-cutting reads that serve chat content ────────────────────
  SearchController_search_v1: {
    status: 'masked',
    proof: {
      spec: 'application/services/search.service.spec.ts',
      test: 'masks a hit from a member the caller has blocked',
    },
  },
  ActivityFeedController_getFeed_v1: {
    // Its announcement items are masked: a blocked author's announcement is
    // left out, reading as the caller. Its other items carry text a member
    // wrote (a backwork title beside its uploader, an event name, a points
    // reason), which is MEMBER_TEXT, still open, so the route is too.
    status: 'open',
    issues: [2498],
    why: "Announcements are masked; the items carrying a member's own text (a backwork title, an event name, a points reason) are not.",
    proof: {
      spec: 'application/services/activity-feed.service.spec.ts',
      test: 'leaves out an announcement whose author the caller has blocked, reading as the caller',
    },
  },
  NotificationController_listNotifications_v1: {
    // Serves every in-app row, whoever wrote it. The chat rows
    // `ChatService.notifyMessageRecipients` writes for DMs and announcements are
    // masked at write time: no row is written for a member who had blocked the
    // sender (PUSH_LEDGER below holds the proofs), and a row written before the
    // block stays, as notification history. The non-chat rows that quote a
    // member's text are MEMBER_TEXT, still open, so the route is too.
    status: 'open',
    issues: [2498],
    why: "Chat rows are masked at write time; the non-chat rows carrying a member's own text (a task title, an event name) are not.",
  },
};

/**
 * Every policy any migration creates that can *read* (`for select`, `for all`,
 * or no command clause), keyed as `schema.table policy_name`, chat or not. A
 * read policy is a way to the rows that skips every API mask, so each one has
 * to answer the block question, including the ones whose answer is "no client
 * role reaches this". Keyed by policy rather than by table so that a new read
 * policy on a table already listed here still has to be classified: a table
 * entry would pre-approve whatever policy came next.
 *
 * Each entry also says how many `create policy` statements carry its name.
 * This repo changes a policy by dropping and re-creating it under the same
 * name, so a new re-creation (a widened role, a looser `using`) keeps its key
 * and would otherwise inherit the old entry's reason. Changing the count forces
 * a person to re-read the reason. `alter policy` is refused outright below, for
 * the same reason.
 *
 * Tables with RLS on and no read policy are absent on purpose
 * (`chat_message_attachments`, `message_reactions`, `chat_member_blocks` and
 * `chat_message_reports` among them): only the API reaches them, and the routes
 * above are where they are masked. A table with RLS *off* would need no policy
 * at all, which is why the gate below also pins RLS on for every public table.
 */
const DIRECT_READ_LEDGER: Record<string, Entry & { creates: number }> = {
  'public.chat_messages chat_messages_select': {
    creates: 2,
    status: 'not-hidden',
    why: "Realtime filters the echo through the subscriber's policy, but a policy can only drop a row, not carry the API's tombstone, and this one has no block clause; § The masking contract makes each client apply its own list instead. Both do, through `@repo/chat-core/blocks`: mobile (#2493, #2315) and web (#2313). A new client that reads this table must too.",
  },
  'public.chat_message_actions chat_message_actions_select': {
    // Reaction chips, over PostgREST and the Realtime echo. The policy drops a
    // blocked member's `reaction:*` rows for the member who blocked them;
    // `vote` rows are counted, not hidden (20260924170000, #2494).
    creates: 3,
    status: 'masked',
    proof: {
      pglite:
        "a blocker reads none of a blocked member's reaction rows in that chapter, and keeps everything else",
    },
  },
  'public.chat_notification_preferences chat_notification_preferences_select_own':
    {
      creates: 1,
      status: 'no-foreign-content',
      why: "Select-own only: the caller's own preferences.",
    },
  'realtime.messages realtime_messages_scoped_select': {
    creates: 2,
    status: 'open',
    issues: [2496],
    why: "Authorizes Broadcast and Presence on `chat:channel:<id>`. Clients act only on presence and `typing`, rendered anonymously, and neither carries message content. A blocked member's `typing` still counts toward that indicator.",
  },
  'public.users auth_admin_can_read_users': {
    creates: 1,
    status: 'no-foreign-content',
    why: '`to supabase_auth_admin` only, for the Auth hook that stamps the active-chapter claim. No client role reaches it.',
  },
  'public.members auth_admin_can_read_members': {
    creates: 1,
    status: 'no-foreign-content',
    why: '`to supabase_auth_admin` only, as `auth_admin_can_read_users`.',
  },
  'public.member_custom_field_values member_custom_field_values_service_role': {
    creates: 1,
    status: 'no-foreign-content',
    why: "`auth.role() = 'service_role'` only. No client role reaches it.",
  },
};

/**
 * Everything that writes a notification or pushes to a lock screen with chat
 * content in it, with the proof that it drops blockers. Keyed by emitter, not by
 * route: none of these is a request the viewer makes. `NOTIFY_EMITTERS` below
 * is what makes this list complete.
 */
const PUSH_LEDGER: Record<string, Entry> = {
  'chat-push-worker (chat_messages INSERT)': {
    status: 'masked',
    proof: {
      spec: 'modules/chat-push-worker/chat-push-worker.service.spec.ts',
      test: 'does not notify a recipient who has blocked the sender',
    },
  },
  'ChatService.notifyMessageRecipients (DM and group DM)': {
    status: 'masked',
    proof: {
      spec: CHAT_SERVICE_SPEC,
      test: 'does not notify a DM recipient who has blocked the sender',
    },
  },
  'ChatService.notifyMessageRecipients (announcements)': {
    status: 'masked',
    proof: {
      spec: CHAT_SERVICE_SPEC,
      test: 'drops blockers from the announcement fan-out',
    },
  },
  'reactions (no push exists)': {
    status: 'masked',
    proof: {
      spec: CHAT_SERVICE_SPEC,
      test: 'does not notify on a hot-path reaction action',
    },
  },
};

/**
 * A non-chat notification whose body carries text some member wrote (a fine
 * reason, a task title, a review comment, an event or invoice name), whoever
 * or whatever triggers it: an officer's action, a webhook, a reminder sweep.
 * The spec hides that same text in chat, and does not say whether a block
 * reaches the notification. Open until #2498 decides it; the person a filter
 * would key on is the text's author, not the trigger.
 */
const MEMBER_TEXT: Entry = {
  status: 'open',
  issues: [2498],
  why: 'Not chat, but delivers text a member wrote, so someone who blocked that member still receives it. Whether a chat block reaches these is undecided.',
};

/**
 * Every file under `apps/api/src` that makes a notify-named call
 * (`notifyUser`, `notifyChapter`, and every wrapper named for them, such as
 * `safeNotifyUser`, `claimAndNotify` or `notifyEligibleMembers`), with how many
 * such calls it makes and what the notifications carry. Counting calls to the
 * wrappers as well as the primitives is the point: a notification added through
 * a notify-named wrapper still moves the count, and fails until someone decides
 * whether it carries another member's words. Calls are read from the syntax
 * tree, so a mention in a comment or a string does not count.
 */
const NOTIFY_EMITTERS: Record<string, { calls: number; entries: Entry[] }> = {
  'application/services/chat.service.ts': {
    calls: 3,
    entries: [
      PUSH_LEDGER['ChatService.notifyMessageRecipients (DM and group DM)'],
      PUSH_LEDGER['ChatService.notifyMessageRecipients (announcements)'],
    ],
  },
  'modules/chat-push-worker/chat-push-worker.service.ts': {
    calls: 1,
    entries: [PUSH_LEDGER['chat-push-worker (chat_messages INSERT)']],
  },
  'application/services/billing.service.ts': {
    calls: 4,
    entries: [
      {
        status: 'no-foreign-content',
        why: 'Subscription status to the president. No member-written text.',
      },
      // The hand-off to `FinancialInvoiceService.notifyStripePaymentFailure`,
      // whose body quotes the invoice title.
      MEMBER_TEXT,
    ],
  },
  'application/services/chat-report.service.ts': {
    calls: 2,
    entries: [
      {
        status: 'no-foreign-content',
        why: 'Fixed text (`REPORT_FILED_NOTIFICATION`) to the officers the report queue admits: no message text, no reporter, no reported member.',
      },
    ],
  },
  'application/services/invite.service.ts': {
    calls: 2,
    entries: [
      {
        status: 'not-hidden',
        why: 'Fixed text, and a system DM naming the member who accepted. A system message that merely names a member is not hidden.',
      },
    ],
  },
  'application/services/event.service.ts': {
    calls: 7,
    entries: [MEMBER_TEXT],
  },
  'application/services/financial-invoice.service.ts': {
    calls: 3,
    entries: [MEMBER_TEXT],
  },
  'application/services/points.service.ts': {
    calls: 1,
    entries: [MEMBER_TEXT],
  },
  'application/services/service-entry.service.ts': {
    calls: 2,
    entries: [MEMBER_TEXT],
  },
  'application/services/task.service.ts': { calls: 6, entries: [MEMBER_TEXT] },
  'modules/scheduled-jobs/scheduled-jobs.service.ts': {
    calls: 12,
    entries: [MEMBER_TEXT],
  },
};

/**
 * Every table the API opens a Realtime `postgres_changes` subscription on. A
 * subscription is how a push gets built, so a new one is a new lock-screen
 * surface, and a reaction subscription would be the reaction push the ledger
 * above says does not exist.
 */
const API_SUBSCRIPTIONS: Record<string, string> = {
  chat_messages:
    'chat-push-worker. Its audience drops blockers (PUSH_LEDGER above).',
  chapter_audit_log:
    'chat-bridge-worker. Posts into #chapter-audit as the system actor, which cannot be blocked.',
};

/**
 * The only migrations that write `storage.buckets`, each read by a person for
 * what it does to the `chat` bucket's `public` flag. A new one fails until it is
 * read and added: a column-order or `insert … select` upsert can flip the
 * bucket public in a shape no pattern here would recognize.
 */
const BUCKET_WRITERS = new Set([
  '20260803231500_service_proof_bucket.sql',
  '20260805133000_reports_bucket.sql',
  '20260808204500_declare_dashboard_created_buckets.sql',
  '20260823124000_chat_archive_bucket.sql',
]);

// ── Readers ──────────────────────────────────────────────────────────────

interface OpenApiDocument {
  paths: Record<string, Record<string, { operationId?: string }>>;
}

function openApiOperationIds(): string[] {
  const doc = JSON.parse(
    readFileSync(join(API_ROOT, 'openapi.json'), 'utf8'),
  ) as OpenApiDocument;
  return Object.values(doc.paths).flatMap((operations) =>
    Object.values(operations)
      .map((operation) => operation.operationId)
      .filter((id): id is string => typeof id === 'string'),
  );
}

/**
 * Comments out, string literals kept, in one left-to-right pass. The single
 * pass is the point: whichever of `'…'`, `--` and `/*` starts first wins, so a
 * `/*` inside a line comment cannot open a block that swallows the policies
 * after it, and a `--` inside a string cannot truncate the line. Dollar-quoted
 * bodies are deliberately not treated as strings, because policies are created
 * inside `execute format($p$ … $p$)` and must still be seen.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(
    /('(?:[^']|'')*')|--[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, literal: string | undefined) => literal ?? ' ',
  );
}

/** Lower-cased `schema.table`, with `public.` filled in when a migration omits it. */
function qualify(name: string): string {
  const bare = name.replace(/"/g, '').toLowerCase();
  return bare.includes('.') ? bare : `public.${bare}`;
}

interface Migration {
  name: string;
  sql: string;
}

function migrations(): Migration[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: stripSqlComments(readFileSync(join(MIGRATIONS, name), 'utf8')),
    }));
}

interface PolicyStatement {
  migration: string;
  table: string;
  policy: string;
  /** Whether it can read: `for select`, `for all`, or no command clause. */
  reads: boolean;
  body: string;
}

/**
 * Every `create policy … on <table>` across the migrations, including ones a
 * later migration drops: a policy that ever existed is a surface that ever
 * existed, and listing it costs one ledger line. The body runs to the end of
 * the statement, or to the dollar-quote that closes it when the policy is
 * created through `execute format($p$ … $p$)`, as `chat_message_actions`'s is.
 */
function policyStatements(all: Migration[]): PolicyStatement[] {
  return all.flatMap(({ name, sql }) =>
    [
      ...sql.matchAll(
        /create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w."]+)([\s\S]*?)(?:;|\$\w*\$)/gi,
      ),
    ].map((match) => {
      const command = /\bfor\s+(select|insert|update|delete|all)\b/i.exec(
        match[3],
      )?.[1];
      return {
        migration: name,
        table: qualify(match[2]),
        policy: match[1].replace(/"/g, ''),
        reads: !command || /^(select|all)$/i.test(command),
        body: match[3],
      };
    }),
  );
}

const parsed = new Map<string, ts.SourceFile>();

/**
 * Parsed once per path and cached, since one proof spec backs many entries.
 * Comments and string contents are not code here.
 */
function parse(file: string): ts.SourceFile {
  let source = parsed.get(file);
  if (!source) {
    source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS,
    );
    parsed.set(file, source);
  }
  return source;
}

function everyNode(root: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    out.push(node);
    node.forEachChild(visit);
  };
  visit(root);
  return out;
}

/** `'x'` or a template with no substitutions: the only literals read as names. */
function literalText(node: ts.Node | undefined): string | undefined {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

/** Every name on `a.b.c`, left to right, so `j.it.only` gives `j`, `it`, `only`. */
function chainNames(node: ts.Expression): string[] {
  const names: string[] = [];
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current)) {
    names.unshift(current.name.text);
    current = current.expression;
  }
  if (ts.isIdentifier(current)) names.unshift(current.text);
  return names;
}

/** What can follow a test function on a chain: `fit.each`, `it.concurrent.only`. */
const JEST_MODIFIERS = new Set([
  'each',
  'concurrent',
  'failing',
  'only',
  'skip',
  'todo',
]);

const SKIPPING_IDENTIFIERS = new Set([
  'xdescribe',
  'xit',
  'xtest',
  'fdescribe',
  'fit',
  'ftest',
]);

/**
 * What makes Jest skip a test in this file, read from the syntax tree: `.skip`,
 * `.only` or `.todo` anywhere on a chain that names `describe`, `it` or `test`
 * (so `it.concurrent.only` and a namespace import's `j.it.only` too), and the
 * `x`/`f` names, whether referenced (`fit(…)`, `cond ? describe : xdescribe`)
 * or called off a namespace (`j.fit(…)`). A focused test
 * anywhere skips the proof, and a skipped block around it leaves the title in
 * place with nothing running. Comments and strings are not in the tree, so the
 * word "fit" in a title is not the identifier.
 */
function skipsOrFocuses(file: ts.SourceFile): boolean {
  return everyNode(file).some(
    (node) =>
      // `fit(…)`, `cond ? describe : xdescribe`.
      (ts.isIdentifier(node) &&
        SKIPPING_IDENTIFIERS.has(node.text) &&
        !isNameOnly(node)) ||
      // `j.fit(…)`, or `j.fit.each(…)` and the like, through a namespace
      // import. A property named `fit` that is only read (`expect(o.fit)`,
      // `layout.fit.width`) is not a focus.
      (ts.isPropertyAccessExpression(node) &&
        SKIPPING_IDENTIFIERS.has(node.name.text) &&
        ((ts.isCallExpression(node.parent) &&
          node.parent.expression === node) ||
          (ts.isPropertyAccessExpression(node.parent) &&
            JEST_MODIFIERS.has(node.parent.name.text)))) ||
      // `.skip` / `.only` / `.todo` anywhere on a chain that names describe,
      // it or test: `it.concurrent.only`, `j.it.only`, `describe.skip.each`.
      (ts.isPropertyAccessExpression(node) &&
        ['skip', 'only', 'todo'].includes(node.name.text) &&
        chainNames(node).some((name) =>
          ['describe', 'it', 'test'].includes(name),
        )),
  );
}

/**
 * An identifier that only names something (`o.fit`, `{ fit: 1 }`, a method
 * called `fit`) rather than referring to a binding. Only a reference can be
 * Jest's `fit`.
 */
function isNameOnly(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  );
}

/**
 * The proof's title is the first argument of a real `it(…)` / `test(…)` call in
 * its spec, and that spec neither skips nor focuses anything. Matching on title
 * rather than on the test body cannot prove the test asserts the right thing;
 * it stops a renamed, deleted, commented-out or skipped proof leaving the
 * ledger vouching for nothing.
 *
 * A PGlite proof is a `name: '…'` property somewhere in the harness, read from
 * its syntax tree, so a name left only in a comment does not count. The
 * harness has no skip or focus to look for: every scenario it declares runs.
 */
function proofProblem(proof: Proof): string | null {
  if ('pglite' in proof) {
    const live = everyNode(parse(PGLITE_HARNESS)).some(
      (node) =>
        ts.isPropertyAssignment(node) &&
        node.name.getText() === 'name' &&
        literalText(node.initializer) === proof.pglite,
    );
    return live
      ? null
      : `scripts/check-pglite-migrations.mjs has no scenario named '${proof.pglite}'`;
  }
  const file = parse(join(API_SRC, proof.spec));
  if (skipsOrFocuses(file)) return `${proof.spec} skips or focuses a test`;
  const live = everyNode(file).some(
    (node) =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ['it', 'test'].includes(node.expression.text) &&
      literalText(node.arguments[0]) === proof.test,
  );
  return live ? null : `${proof.spec} has no live it('${proof.test}')`;
}

/** Every non-spec `.ts` under apps/api/src, parsed. */
function apiSources(): { rel: string; file: ts.SourceFile }[] {
  const out: { rel: string; file: ts.SourceFile }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        out.push({ rel: full.slice(API_SRC.length + 1), file: parse(full) });
      }
    }
  };
  walk(API_SRC);
  return out;
}

// ── The gate ─────────────────────────────────────────────────────────────

describe('chat read-surface ledger (#2324)', () => {
  const operationIds = openApiOperationIds();
  const allMigrations = migrations();
  const policies = policyStatements(allMigrations);
  const sources = apiSources();
  const readPolicyKeys = [
    ...new Set(
      policies
        .filter(({ reads }) => reads)
        .map(({ table, policy }) => `${table} ${policy}`),
    ),
  ];

  it('is reading the real contract, migrations and source, not empty ones', () => {
    // Anchors every check below: a moved file or a bad path would otherwise
    // make "nothing unclassified" pass vacuously.
    expect(operationIds).toContain('ChatController_getMessages_v1');
    expect(readPolicyKeys).toContain(
      'public.chat_message_actions chat_message_actions_select',
    );
    expect(sources.length).toBeGreaterThan(100);
    expect(typeof ts.createSourceFile).toBe('function');
  });

  it('classifies every operation of a chat-owning controller', () => {
    const inScope = operationIds.filter((id) =>
      CHAT_CONTROLLERS.some((controller) => id.startsWith(`${controller}_`)),
    );
    const unclassified = inScope.filter((id) => !(id in HTTP_LEDGER));
    // A route here serves chat data to a named viewer. Decide what it does
    // about that viewer's block list — mask it, and name the test — or say
    // why it carries no one else's content, before it ships.
    expect(unclassified).toEqual([]);
  });

  it('names only operations that still exist', () => {
    const known = new Set(operationIds);
    expect(Object.keys(HTTP_LEDGER).filter((id) => !known.has(id))).toEqual([]);
  });

  it('classifies every policy a client could read through', () => {
    // Ledger it, and decide what a block does on that path. A policy no client
    // role reaches still gets an entry saying so.
    expect(
      readPolicyKeys.filter((key) => !(key in DIRECT_READ_LEDGER)),
    ).toEqual([]);
    expect(
      Object.keys(DIRECT_READ_LEDGER).filter(
        (key) => !readPolicyKeys.includes(key),
      ),
    ).toEqual([]);
  });

  it('notices a read policy re-created or altered under a name it already knows', () => {
    // A same-name re-creation keeps the key but can change the role or the
    // `using` clause the entry's reason depends on, so the count has to be
    // bumped by someone who re-read the new statement. `alter policy` changes
    // the same things with no `create` at all, so it is not allowed.
    const counts = new Map<string, number>();
    for (const { table, policy, reads } of policies) {
      if (!reads) continue;
      const key = `${table} ${policy}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(
      Object.entries(DIRECT_READ_LEDGER)
        .filter(([key, entry]) => counts.get(key) !== entry.creates)
        .map(
          ([key, entry]) =>
            `${key}: ledger ${entry.creates}, migrations ${counts.get(key) ?? 0}`,
        ),
    ).toEqual([]);
    expect(
      allMigrations
        .filter(({ sql }) => /\balter\s+policy\b/i.test(sql))
        .map(({ name }) => name),
    ).toEqual([]);
  });

  it('keeps RLS on for every public table, so no table is readable without a policy', () => {
    // With RLS off, PostgREST serves a table to any client under the default
    // grants and no policy is involved, so the check above would never see it.
    // `check:pglite-migrations` asserts the same thing against a replayed
    // database (a required check since #2538); this one reads the migration
    // text, so it fails in the unit suite before any replay runs. Statements
    // are replayed in order, so a table dropped and re-created without its
    // `enable` is off, while `create table if not exists` on a table that
    // already exists is the no-op Postgres makes it. A `disable` fails in any
    // schema, since
    // `realtime.messages` and `storage.objects` are exactly the tables whose
    // RLS the chat surfaces depend on.
    const rls = new Map<string, 'on' | 'off'>();
    const disabled: string[] = [];
    const statement =
      /create\s+(?:unlogged\s+)?table\s+(if\s+not\s+exists\s+)?([\w."]+)|drop\s+table\s+(?:if\s+exists\s+)?([\w.",\s]+?)\s*(?:cascade|restrict)?\s*;|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+(enable|disable)\s+row\s+level\s+security/gi;
    for (const { name: migration, sql } of allMigrations) {
      for (const match of sql.matchAll(statement)) {
        if (match[2]) {
          const table = qualify(match[2]);
          if (!(match[1] && rls.has(table))) rls.set(table, 'off');
        } else if (match[3]) {
          for (const name of match[3].split(','))
            rls.delete(qualify(name.trim()));
        } else if (match[4]) {
          const table = qualify(match[4]);
          const enable = match[5].toLowerCase() === 'enable';
          rls.set(table, enable ? 'on' : 'off');
          if (!enable) disabled.push(`${migration}: ${table}`);
        }
      }
    }
    const tables = [...rls.keys()].filter((table) =>
      table.startsWith('public.'),
    );
    expect(tables.length).toBeGreaterThan(40);
    expect(tables.filter((table) => rls.get(table) !== 'on')).toEqual([]);
    expect(disabled).toEqual([]);
  });

  it('keeps the API the only path to chat attachments', () => {
    // `listMessageAttachments` is where a blocked member's files are withheld,
    // and that is only sufficient while nothing else can reach them.
    // `chat_message_attachments` must carry no policy (its RLS is pinned on
    // above), and there must be no storage policy at all: every bucket is
    // private and reached through API-signed URLs (`spec/architecture/README.md`
    // § 7), so a storage policy is a design change, not a detail, however its
    // bucket filter is spelled.
    expect(
      policies
        .filter(
          ({ table }) =>
            table === 'public.chat_message_attachments' ||
            table === 'storage.objects',
        )
        .map(({ migration, table }) => `${migration}: ${table}`),
    ).toEqual([]);

    // And the bucket stays private: its one declaration says `public = false`,
    // and nothing else writes `storage.buckets` without having been read.
    const declarations = allMigrations.flatMap(({ name, sql }) =>
      [...sql.matchAll(/\(\s*'chat'\s*,\s*'chat'\s*,\s*(\w+)/gi)].map(
        (match) => `${name}: public=${match[1].toLowerCase()}`,
      ),
    );
    expect(declarations.length).toBeGreaterThan(0);
    expect(declarations.filter((d) => !d.endsWith('public=false'))).toEqual([]);
    expect(
      allMigrations
        .filter(({ sql }) =>
          /(?:insert\s+into|update)\s+"?storage"?\s*\.\s*"?buckets"?/i.test(
            sql,
          ),
        )
        .map(({ name }) => name)
        .filter((name) => !BUCKET_WRITERS.has(name)),
    ).toEqual([]);
  });

  it('opens Realtime subscriptions only on ledgered tables', () => {
    // Read from the syntax tree, one subscription at a time. Every literal
    // `'postgres_changes'` (or `REALTIME_LISTEN_TYPES.POSTGRES_CHANGES`) in
    // API code has to be the event argument of an `.on(…)` call whose filter
    // is an object literal naming a `table` in API_SUBSCRIPTIONS. The event held
    // in a variable, a filter with no table (every table at once), or a table
    // held in a constant is a problem to resolve by hand, never a pass. Prose
    // about the echo inside a longer string is not the literal and does not
    // count. A reaction subscription would be a reaction push.
    // The event written as a single literal inside apps/api/src, in any
    // position: either string (`'postgres_changes'`, or `'POSTGRES_CHANGES'`
    // as a quoted or computed key), the enum member read as a property or an element, or the
    // bare name, whether referenced, destructured (renamed or not, as a
    // declaration or an assignment) or imported. Anything but the event
    // argument of an `.on(…)` call is a problem to resolve by hand: the local
    // name a destructure binds could be anything. The one position skipped is
    // the name half of `X.POSTGRES_CHANGES`, where the access itself counts.
    const isEvent = (node: ts.Node | undefined): boolean => {
      if (!node) return false;
      const text = literalText(node);
      if (text === 'postgres_changes' || text === 'POSTGRES_CHANGES') {
        return true;
      }
      if (ts.isPropertyAccessExpression(node)) {
        return node.name.text === 'POSTGRES_CHANGES';
      }
      // A key spelled `POSTGRES_CHANGES`, on whatever object, as the enum is
      // indexed. The object itself is not checked. `m['postgres_changes']` is a
      // lookup that could hold anything, so its literal is reported on its own.
      if (ts.isElementAccessExpression(node)) {
        return literalText(node.argumentExpression) === 'POSTGRES_CHANGES';
      }
      return (
        ts.isIdentifier(node) &&
        node.text === 'POSTGRES_CHANGES' &&
        !(
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node
        )
      );
    };
    const subscribed = new Set<string>();
    const problems = sources.flatMap(({ rel, file }) =>
      everyNode(file)
        .filter(
          (node) =>
            isEvent(node) &&
            !(
              (ts.isPropertyAccessExpression(node.parent) ||
                ts.isElementAccessExpression(node.parent)) &&
              isEvent(node.parent)
            ),
        )
        .flatMap((event) => {
          const call = event.parent;
          const where = `${rel}:${file.getLineAndCharacterOfPosition(event.getStart()).line + 1}`;
          if (
            !ts.isCallExpression(call) ||
            call.arguments[0] !== event ||
            !ts.isPropertyAccessExpression(call.expression) ||
            call.expression.name.text !== 'on'
          ) {
            return [`${where}: postgres_changes outside an .on(…) call`];
          }
          const filter = call.arguments[1];
          const table =
            filter && ts.isObjectLiteralExpression(filter)
              ? filter.properties.find(
                  (property): property is ts.PropertyAssignment =>
                    ts.isPropertyAssignment(property) &&
                    property.name.getText() === 'table',
                )
              : undefined;
          const name = literalText(table?.initializer);
          if (name === undefined) {
            return [`${where}: subscription with no literal table`];
          }
          subscribed.add(name);
          return name in API_SUBSCRIPTIONS ? [] : [`${where}: ${name}`];
        }),
    );
    expect(problems).toEqual([]);
    // The anchor: every ledgered subscription is actually seen. A scan that
    // silently stopped recognizing subscriptions would otherwise pass here.
    expect([...subscribed].sort()).toEqual(
      Object.keys(API_SUBSCRIPTIONS).sort(),
    );
  });

  it('knows every notification emitter, and every notify-named call in it', () => {
    // A call counts when any name on its callee chain contains "notify", so
    // `this.notifyUser.call(…)`, `notifyUser?.(…)` and `svc.notifyUser<T>(…)`
    // all count. Declarations do not: these are call sites.
    const found: Record<string, number> = {};
    for (const { rel, file } of sources) {
      const calls = everyNode(file).filter((node) => {
        if (!ts.isCallExpression(node)) return false;
        let callee: ts.Expression = node.expression;
        for (;;) {
          const name = ts.isIdentifier(callee)
            ? callee.text
            : ts.isPropertyAccessExpression(callee)
              ? callee.name.text
              : '';
          if (/notify/i.test(name)) return true;
          if (!ts.isPropertyAccessExpression(callee)) return false;
          callee = callee.expression;
        }
      }).length;
      if (calls > 0) found[rel] = calls;
    }
    const expected = Object.fromEntries(
      Object.entries(NOTIFY_EMITTERS).map(([rel, { calls }]) => [rel, calls]),
    );
    // A new or moved notification lands here. If it carries another member's
    // words, it has to drop blockers and name the proof, or be open against an
    // issue that decides whether it must.
    expect(found).toEqual(expected);

    // Every emitter in PUSH_LEDGER is claimed by the file that emits it, so
    // deleting one (and its proof) cannot leave that file vouched for by
    // another. An entry that names a PUSH_LEDGER key that no longer exists is
    // undefined here, and fails the same way.
    const claimed = Object.values(NOTIFY_EMITTERS).flatMap(
      ({ entries }) => entries,
    );
    expect(claimed.filter((entry) => entry === undefined)).toEqual([]);
    expect(
      Object.entries(PUSH_LEDGER)
        .filter(([key]) => key !== 'reactions (no push exists)')
        .filter(([, entry]) => !claimed.includes(entry))
        .map(([key]) => key),
    ).toEqual([]);
  });

  const allEntries: [string, Entry][] = [
    ...Object.entries(HTTP_LEDGER),
    ...Object.entries(DIRECT_READ_LEDGER),
    ...Object.entries(PUSH_LEDGER),
    ...Object.entries(NOTIFY_EMITTERS).flatMap(([rel, { entries }]) =>
      entries.map((entry, i) => [`${rel} #${i + 1}`, entry] as [string, Entry]),
    ),
  ];

  it.each(
    allEntries.flatMap(([key, entry]): (readonly [string, Proof])[] =>
      (entry.status === 'masked' || entry.status === 'open') && entry.proof
        ? [[key, entry.proof]]
        : [],
    ),
  )('%s names a live proof test', (_key, proof) => {
    expect(proofProblem(proof)).toBeNull();
  });

  it('gives every unmasked entry a reason, and every open one an issue', () => {
    const missing = allEntries.flatMap(([key, entry]) => {
      if (entry.status === 'masked') return [];
      if (entry.why.trim() === '') return [`${key}: no reason`];
      if (entry.status === 'open' && entry.issues.length === 0) {
        return [`${key}: open with no issue`];
      }
      return [];
    });
    expect(missing).toEqual([]);
  });
});
