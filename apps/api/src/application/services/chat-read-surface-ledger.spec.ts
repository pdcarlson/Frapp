import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
 * - every call to `notifyUser` / `notifyChapter` in the API, counted per file,
 *   and every Realtime subscription the API opens, since that is how a new
 *   push gets built.
 *
 * What it cannot see, so nobody reads a green run as more than it is:
 * - a chat read added to a controller outside `CHAT_CONTROLLERS`;
 * - an existing notification edited to carry another member's words, since
 *   the per-file count does not move;
 * - member text re-posted under the system actor, which cannot be blocked. The
 *   poll-expiry notice quotes the poll's question this way (#2495);
 * - a policy or table written through dynamic SQL assembled from parts.
 *
 * A `masked` entry names the test that proves it, and that test must be live:
 * present, not commented out, in a spec that skips and focuses nothing. That
 * cannot prove the test asserts the right thing, but it stops a renamed,
 * deleted or disabled proof leaving the ledger vouching for nothing. An `open`
 * entry is a known gap, and names the issue tracking it. The ledger's job is to
 * keep gaps visible, not to pretend there are none.
 */

/** Paths are relative to `apps/api/src`. */
interface Proof {
  spec: string;
  test: string;
}

type Entry =
  | { status: 'masked'; proof: Proof }
  /** Serves nothing another member authored: metadata, counts, or the caller's own writes. */
  | { status: 'no-foreign-content'; why: string }
  /** Serves another member's content on purpose. The spec's table says so. */
  | { status: 'not-hidden'; why: string }
  /** A known gap, tracked. */
  | { status: 'open'; issues: number[]; why: string };

const API_SRC = join(__dirname, '..', '..');
const API_ROOT = join(API_SRC, '..');
const MIGRATIONS = join(API_ROOT, '..', '..', 'supabase', 'migrations');

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
    status: 'no-foreign-content',
    why: "Counts only. A blocked member's messages still count, because each renders as a tombstone the blocker can expand.",
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
  // DIRECT_READ_LEDGER below, and it is still open.
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
    status: 'masked',
    proof: {
      spec: 'application/services/activity-feed.service.spec.ts',
      test: "reads announcements through getMessages as the caller, so the mask is the caller's own list",
    },
  },
  NotificationController_listNotifications_v1: {
    // Serves the in-app rows `ChatService.sendMessageNotification` writes for
    // DMs and announcements, so its guarantee is made at write time: no row is
    // written for a member who had blocked the sender. A row written before the
    // block stays, as notification history.
    status: 'masked',
    proof: {
      spec: CHAT_SERVICE_SPEC,
      test: 'does not notify a DM recipient who has blocked the sender',
    },
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
    status: 'open',
    issues: [2315, 2313],
    why: 'The Realtime echo carries no viewer and cannot be masked by the server; § The masking contract makes each client apply its own list. Neither client has one yet.',
  },
  'public.chat_message_actions chat_message_actions_select': {
    creates: 2,
    status: 'open',
    issues: [2494],
    why: "Reaction chips: a blocked member's `reaction:*` rows reach the blocker over PostgREST and Realtime. `vote` rows are counted, not hidden, by design.",
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
  'ChatService.sendMessageNotification (DM and group DM)': {
    status: 'masked',
    proof: {
      spec: CHAT_SERVICE_SPEC,
      test: 'does not notify a DM recipient who has blocked the sender',
    },
  },
  'ChatService.sendMessageNotification (announcements)': {
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
 * Every file under `apps/api/src` that mentions a notify-named call
 * (`notifyUser`, `notifyChapter`, and every wrapper around them, such as
 * `safeNotifyUser`, `claimAndNotify` or `notifyEligibleMembers`), with how many
 * times and what the notifications carry. Counting every such token rather than
 * the two primitives is the point: a notification added through a wrapper, or
 * a new wrapper, still moves the count and fails until someone decides whether
 * it carries another member's words. Definitions count too, so the numbers are
 * token counts, not notification counts.
 */
const NOTIFY_EMITTERS: Record<string, { tokens: number; entries: Entry[] }> = {
  'application/services/notification.service.ts': {
    tokens: 2,
    entries: [
      {
        status: 'no-foreign-content',
        why: 'Defines `notifyUser` and `notifyChapter`; every caller is listed here.',
      },
    ],
  },
  'application/services/chat.service.ts': {
    tokens: 2,
    entries: [
      PUSH_LEDGER['ChatService.sendMessageNotification (DM and group DM)'],
      PUSH_LEDGER['ChatService.sendMessageNotification (announcements)'],
    ],
  },
  'modules/chat-push-worker/chat-push-worker.service.ts': {
    tokens: 1,
    entries: [PUSH_LEDGER['chat-push-worker (chat_messages INSERT)']],
  },
  'application/services/billing.service.ts': {
    tokens: 5,
    entries: [
      {
        status: 'no-foreign-content',
        why: 'Subscription status to the president, and a hand-off to the invoice payment-failure notice. No member-written text.',
      },
    ],
  },
  'application/services/invite.service.ts': {
    tokens: 3,
    entries: [
      {
        status: 'not-hidden',
        why: 'Fixed text, and a system DM naming the member who accepted. A system message that merely names a member is not hidden.',
      },
    ],
  },
  'application/services/event.service.ts': {
    tokens: 9,
    entries: [MEMBER_TEXT],
  },
  'application/services/financial-invoice.service.ts': {
    tokens: 4,
    entries: [MEMBER_TEXT],
  },
  'application/services/points.service.ts': {
    tokens: 1,
    entries: [MEMBER_TEXT],
  },
  'application/services/service-entry.service.ts': {
    tokens: 2,
    entries: [MEMBER_TEXT],
  },
  'application/services/task.service.ts': { tokens: 8, entries: [MEMBER_TEXT] },
  'modules/scheduled-jobs/scheduled-jobs.service.ts': {
    tokens: 19,
    entries: [MEMBER_TEXT],
  },
};

/**
 * Files that mention `postgres_changes` without subscribing, each read by a
 * person. Everything else that mentions it is treated as a subscription.
 */
const POSTGRES_CHANGES_PROSE: Record<string, string> = {
  'interface/dtos/chat.dto.ts':
    'An `@ApiProperty` description of the Realtime echo. It subscribes to nothing.',
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

/** JS comments out, so a commented-out proof is not a proof. */
function stripJsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/**
 * String and template literals emptied, so an identifier test sees code only:
 * the English word "fit" in a test title is not `fit`. Template `${…}` parts go
 * with the literal, which errs toward seeing less code, never more words.
 */
function stripJsStrings(source: string): string {
  return source.replace(
    /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
    "''",
  );
}

/**
 * Anything that makes Jest skip a test in this file: `.skip`, `.only` and
 * `.todo` on `describe`, `it` or `test`, with or without `.concurrent`, and
 * the `x`/`f` prefixes, in any position (a call, or a value such as
 * `cond ? describe : xdescribe`). Tested against code with strings removed. A
 * focused test anywhere skips the proof; a skipped block around it leaves the
 * title in place with nothing running.
 */
const SKIPS_OR_FOCUSES =
  /\b(?:describe|it|test)(?:\.concurrent)?\.(?:skip|only|todo)\b|\b[xf](?:describe|it|test)\b/;

/**
 * The proof's title appears as a live `it(` in its spec, and that spec neither
 * skips nor focuses anything. Matching on title rather than on the test body
 * cannot prove the test asserts the right thing; it stops a renamed, deleted,
 * commented-out or skipped proof leaving the ledger vouching for nothing.
 */
function proofProblem(proof: Proof): string | null {
  const source = stripJsComments(
    readFileSync(join(API_SRC, proof.spec), 'utf8'),
  );
  if (SKIPS_OR_FOCUSES.test(stripJsStrings(source))) {
    return `${proof.spec} skips or focuses a test`;
  }
  const escaped = proof.test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`\\bit\\(\\s*(['"\`])${escaped}\\1`).test(source)) {
    return `${proof.spec} has no live it('${proof.test}')`;
  }
  return null;
}

/** Every non-spec `.ts` under apps/api/src. */
function apiSources(): { rel: string; code: string }[] {
  const out: { rel: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        out.push({
          rel: full.slice(API_SRC.length + 1),
          code: stripJsComments(readFileSync(full, 'utf8')),
        });
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
    // database, but it is advisory; this one is not. Statements are replayed
    // in order, so a table dropped and re-created without its `enable` is off,
    // while `create table if not exists` on a table that already exists is the
    // no-op Postgres makes it. A `disable` fails in any schema, since
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
    // Any file whose code mentions the event at all counts as subscribing,
    // however the mention is written, unless a person has read it and listed
    // it in POSTGRES_CHANGES_PROSE. Matching a particular call shape lost a
    // form every time it was tightened; mentioning is what cannot be dodged.
    // Every subscribing file has to name its tables as literals, so this can
    // read them, and each table has to be in API_SUBSCRIPTIONS. A subscription
    // on a reaction table would be a reaction push; one with no table filter
    // would be every table at once.
    const mentions = /postgres_changes|POSTGRES_CHANGES/;
    expect(
      Object.keys(POSTGRES_CHANGES_PROSE).filter(
        (rel) => !sources.some((s) => s.rel === rel && mentions.test(s.code)),
      ),
    ).toEqual([]);
    const problems = sources
      .filter(
        ({ rel, code }) =>
          mentions.test(code) && !(rel in POSTGRES_CHANGES_PROSE),
      )
      .flatMap(({ rel, code }) => {
        const tables = [...code.matchAll(/\btable:\s*(['"`])([\w.]+)\1/g)].map(
          (match) => match[2],
        );
        if (tables.length === 0) {
          return [`${rel}: postgres_changes with no literal table`];
        }
        return tables
          .filter((table) => !(table in API_SUBSCRIPTIONS))
          .map((table) => `${rel}: ${table}`);
      });
    expect(problems).toEqual([]);
  });

  it('knows every notification emitter, and every notify-named call in it', () => {
    const found: Record<string, number> = {};
    for (const { rel, code } of sources) {
      const tokens = code.match(/\b\w*[Nn]otify\w*\s*\(/g)?.length ?? 0;
      if (tokens > 0) found[rel] = tokens;
    }
    const expected = Object.fromEntries(
      Object.entries(NOTIFY_EMITTERS).map(([rel, { tokens }]) => [rel, tokens]),
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
    allEntries.flatMap(([key, entry]) =>
      entry.status === 'masked' ? [[key, entry.proof] as const] : [],
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
