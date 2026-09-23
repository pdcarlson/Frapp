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
 * - every table any migration grants an RLS policy on, which is how a client
 *   reads around the API entirely (PostgREST and the Realtime
 *   `postgres_changes` echo), with RLS pinned on for every public table so a
 *   table cannot be read with no policy at all;
 * - every emitter that writes a notification or a push, and every Realtime
 *   subscription the API opens, since that is how a new push gets built.
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
 * Every table any migration grants an RLS policy on, keyed as `schema.table`,
 * chat or not. A policy is a way to the rows that skips every API mask, so each
 * one has to answer the block question, including the ones whose answer is
 * "carries no chat content". Tables with RLS on and no policy are absent on
 * purpose (`chat_message_attachments`, `message_reactions`, `chat_member_blocks`
 * and `chat_message_reports` among them): only the API reaches them, and the
 * routes above are where they are masked. A table with RLS *off* would need no
 * policy at all, which is why the gate below also pins RLS on for every table.
 */
const DIRECT_READ_LEDGER: Record<string, Entry> = {
  'public.chat_messages': {
    status: 'open',
    issues: [2315, 2313],
    why: 'The Realtime echo carries no viewer and cannot be masked by the server; § The masking contract makes each client apply its own list. Neither client has one yet.',
  },
  'public.chat_message_actions': {
    status: 'open',
    issues: [2494],
    why: "Reaction chips: a blocked member's `reaction:*` rows reach the blocker over PostgREST and Realtime. `vote` rows are counted, not hidden, by design.",
  },
  'public.chat_notification_preferences': {
    status: 'no-foreign-content',
    why: "Select-own only: the caller's own preferences.",
  },
  'realtime.messages': {
    status: 'open',
    issues: [2496],
    why: "Authorizes Broadcast and Presence on `chat:channel:<id>`. Clients act only on presence and `typing`, rendered anonymously, and neither carries message content. A blocked member's `typing` still counts toward that indicator.",
  },
  'public.users': {
    status: 'not-hidden',
    why: 'Directory data. "Blocking is a chat control, not a chapter-membership one."',
  },
  'public.members': {
    status: 'not-hidden',
    why: 'Directory data, as `public.users`.',
  },
  'public.member_custom_field_values': {
    status: 'not-hidden',
    why: 'Directory data, as `public.users`.',
  },
  'public.chapter_audit_log': {
    status: 'no-foreign-content',
    why: 'Admin actions, not chat. Its #chapter-audit bridge posts as the system actor, which cannot be blocked.',
  },
};

/**
 * Everything that writes a notification or pushes to a lock screen with chat
 * content in it. Keyed by emitter, not by route: none of these is a request
 * the viewer makes.
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
        /create\s+policy\s+(?:"[^"]+"|\w+)\s+on\s+([\w."]+)([\s\S]*?)(?:;|\$\w*\$)/gi,
      ),
    ].map((match) => ({
      migration: name,
      table: qualify(match[1]),
      body: match[2],
    })),
  );
}

/** JS comments out, so a commented-out proof is not a proof. */
function stripJsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/**
 * The proof's title appears as a live `it(` in its spec, and that spec neither
 * skips nor focuses anything. A skipped `describe` around the proof would leave
 * the title in place with nothing running, and a focused one elsewhere in the
 * file would skip the proof. Matching on title rather than on the test body
 * cannot prove the test asserts the right thing; it stops a renamed, deleted,
 * commented-out or skipped proof leaving the ledger vouching for nothing.
 */
function proofProblem(proof: Proof): string | null {
  const source = stripJsComments(
    readFileSync(join(API_SRC, proof.spec), 'utf8'),
  );
  if (
    /\b(?:describe|it|test)\.(?:skip|only|todo)\b|\bx(?:describe|it)\(|\bf(?:describe|it)\(/.test(
      source,
    )
  ) {
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

  it('is reading the real contract and the real migrations, not empty ones', () => {
    // Anchors every check below: a moved file or a bad path would otherwise
    // make "nothing unclassified" pass vacuously.
    expect(operationIds).toContain('ChatController_getMessages_v1');
    expect(policies.map(({ table }) => table)).toContain(
      'public.chat_message_actions',
    );
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

  it('classifies every table a client can read directly', () => {
    const tables = [...new Set(policies.map(({ table }) => table))];
    // Ledger it, and decide what a block does on that path. A policy on a
    // table with no chat content in it still gets an entry saying so.
    expect(tables.filter((table) => !(table in DIRECT_READ_LEDGER))).toEqual(
      [],
    );
  });

  it('keeps RLS on for every public table, so no table is readable without a policy', () => {
    // With RLS off, PostgREST serves a table to any client under the default
    // grants and no policy is involved, so the check above would never see it.
    // `check:pglite-migrations` asserts the same thing against a replayed
    // database, but it is advisory; this one is not.
    const created = new Set<string>();
    const enabled = new Set<string>();
    const disabled: string[] = [];
    for (const { name, sql } of allMigrations) {
      for (const match of sql.matchAll(
        /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi,
      )) {
        const table = qualify(match[1]);
        if (table.startsWith('public.')) created.add(table);
      }
      for (const match of sql.matchAll(
        /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+enable\s+row\s+level\s+security/gi,
      )) {
        enabled.add(qualify(match[1]));
      }
      for (const match of sql.matchAll(
        /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+disable\s+row\s+level\s+security/gi,
      )) {
        disabled.push(`${name}: ${qualify(match[1])}`);
      }
    }
    expect(created.size).toBeGreaterThan(40);
    expect([...created].filter((table) => !enabled.has(table))).toEqual([]);
    expect(disabled).toEqual([]);
  });

  it('keeps the API the only path to chat attachments', () => {
    // `listMessageAttachments` is where a blocked member's files are withheld,
    // and that is only sufficient while nothing else can reach them.
    // `chat_message_attachments` must carry no policy (its RLS is pinned on
    // above), and the `chat` bucket must stay private with no storage policy
    // that could reach it. A storage policy is allowed only when it names its
    // buckets and none of them is `chat`: one with no `bucket_id` filter, or one
    // that mentions 'chat' in any form (`=`, `in (…)`, `any(…)`), fails here.
    const offending = policies
      .filter(
        ({ table, body }) =>
          table === 'public.chat_message_attachments' ||
          (table === 'storage.objects' &&
            (!/bucket_id/.test(body) || /'chat'/.test(body))),
      )
      .map(({ migration, table }) => `${migration}: ${table}`);
    expect(offending).toEqual([]);

    const declarations = allMigrations.flatMap(({ name, sql }) =>
      [...sql.matchAll(/\(\s*'chat'\s*,\s*'chat'\s*,\s*(\w+)/gi)].map(
        (match) => `${name}: public=${match[1].toLowerCase()}`,
      ),
    );
    expect(declarations.length).toBeGreaterThan(0);
    expect(declarations.filter((d) => !d.endsWith('public=false'))).toEqual([]);
    // No migration updates a bucket in place. One that does has to be read by
    // a person before this passes, since it could flip `chat` public.
    expect(
      allMigrations
        .filter(({ sql }) => /update\s+storage\.buckets/i.test(sql))
        .map(({ name }) => name),
    ).toEqual([]);
  });

  it('opens Realtime subscriptions only on ledgered tables', () => {
    // Every `postgres_changes` subscription has to name its table as a literal,
    // so this can read it, and the table has to be in API_SUBSCRIPTIONS. A
    // subscription on a reaction table would be a reaction push; one with no
    // table filter would be every table at once.
    const sources = apiSources();
    expect(sources.length).toBeGreaterThan(100);
    // The call shape, not the word: prose about the echo (a DTO description,
    // a log line) must not count as a subscription.
    const subscribes =
      /\.on\(\s*(?:(['"`])postgres_changes\1|REALTIME_LISTEN_TYPES\.POSTGRES_CHANGES)/;
    const problems = sources
      .filter(({ code }) => subscribes.test(code))
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

  const allEntries: [string, Entry][] = [
    ...Object.entries(HTTP_LEDGER),
    ...Object.entries(DIRECT_READ_LEDGER),
    ...Object.entries(PUSH_LEDGER),
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
