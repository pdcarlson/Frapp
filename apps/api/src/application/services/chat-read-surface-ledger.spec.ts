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
 * enumerated the rest. So this file **enumerates, and fails on anything
 * unclassified**:
 *
 * - every operation `openapi.json` gives a chat-owning controller, plus the two
 *   cross-cutting reads that serve chat content (search, the activity feed);
 * - every table any migration grants an RLS policy on whose name marks it as
 *   chat, which is how a client reads around the API entirely (PostgREST and
 *   the Realtime `postgres_changes` echo);
 * - the push fan-out.
 *
 * A `masked` entry names the test that proves it, and the test's title must
 * still exist in that file. That cannot prove the test asserts the right thing,
 * but it stops a renamed or deleted proof leaving the ledger vouching for
 * nothing. An `open` entry is a known gap, and names the issue tracking it.
 * The ledger's job is to keep gaps visible, not to pretend there are none.
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
};

/**
 * Tables a client can read without the API, keyed as `schema.table`. Anything
 * a migration grants a policy on that looks like chat has to appear here.
 * `chat_message_attachments`, `message_reactions`, `chat_member_blocks` and
 * `chat_message_reports` are deliberately absent: they carry RLS with no policy
 * at all, so the API is the only path to them, and the API routes above are
 * where they are masked.
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
    status: 'no-foreign-content',
    why: 'Authorizes Broadcast and Presence on `chat:channel:<id>`, which carry presence, typing, and contentless change pings. Messages travel over Postgres Changes, never Broadcast.',
  },
};

/** The push fan-out, the one surface that reaches a lock screen. */
const PUSH_LEDGER: Record<string, Entry> = {
  'chat-push-worker (chat_messages INSERT)': {
    status: 'masked',
    proof: {
      spec: 'modules/chat-push-worker/chat-push-worker.service.spec.ts',
      test: 'does not notify a recipient who has blocked the sender',
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

/** Line and block comments out, so prose that discusses a policy is not one. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
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
function policyStatements(): PolicyStatement[] {
  const out: PolicyStatement[] = [];
  for (const migration of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = stripSqlComments(
      readFileSync(join(MIGRATIONS, migration), 'utf8'),
    );
    const re =
      /create\s+policy\s+(?:"[^"]+"|\w+)\s+on\s+([\w."]+)([\s\S]*?)(?:;|\$\w*\$)/gi;
    for (const match of sql.matchAll(re)) {
      const raw = match[1].replace(/"/g, '');
      out.push({
        migration,
        table: raw.includes('.') ? raw : `public.${raw}`,
        body: match[2],
      });
    }
  }
  return out;
}

function isChatTable(table: string): boolean {
  return /(^|\.)(chat_|message_)/.test(table) || table === 'realtime.messages';
}

function specHasTest(proof: Proof): boolean {
  const source = readFileSync(join(API_SRC, proof.spec), 'utf8');
  const escaped = proof.test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\bit\\(\\s*(['"\`])${escaped}\\1`).test(source);
}

// ── The gate ─────────────────────────────────────────────────────────────

describe('chat read-surface ledger (#2324)', () => {
  const operationIds = openApiOperationIds();
  const policies = policyStatements();

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

  it('classifies every chat table a client can read directly', () => {
    const tables = [
      ...new Set(
        policies
          .map(({ table }) => table)
          .filter((table) => isChatTable(table)),
      ),
    ];
    // A policy is a way to the rows that skips every API mask. Ledger it, and
    // decide what a block does on that path.
    expect(tables.filter((table) => !(table in DIRECT_READ_LEDGER))).toEqual(
      [],
    );
  });

  it('keeps the API the only path to chat attachments', () => {
    // `listMessageAttachments` is where a blocked member's files are withheld,
    // and that is only sufficient while nothing else can reach them. A read
    // policy on the table, or a storage policy on the bucket, would be a path
    // around that check, and needs its own masking decision before it lands.
    const attachmentPolicies = policies.filter(
      ({ table, body }) =>
        table === 'public.chat_message_attachments' ||
        (table === 'storage.objects' && /bucket_id\s*=\s*'chat'/.test(body)),
    );
    expect(
      attachmentPolicies.map(
        ({ migration, table }) => `${migration}: ${table}`,
      ),
    ).toEqual([]);
  });

  it('opens no API subscription to a reaction table, so no reaction can push', () => {
    // The push worker subscribes to `chat_messages` INSERT, and its audience is
    // filtered for blocks. Nothing notifies on a reaction. A subscription here
    // would be a reaction push, which has to drop blockers from its audience
    // first, the way `ChatBlockService.filterOutBlockers` does.
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'))
          sources.push(full);
      }
    };
    walk(API_SRC);
    expect(sources.length).toBeGreaterThan(100);

    const hits = sources
      .filter((file) =>
        /table:\s*['"](chat_message_actions|message_reactions)['"]/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => file.slice(API_SRC.length + 1));
    expect(hits).toEqual([]);
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
  )('%s names a proof test that still exists', (_key, proof) => {
    expect(specHasTest(proof)).toBe(true);
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
