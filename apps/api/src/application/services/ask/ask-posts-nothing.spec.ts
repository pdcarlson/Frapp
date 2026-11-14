import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A question asked from a chat composer is answered to the asker alone
 * (#4713, `spec/behavior/ai.md` § Asking from a channel): nothing is written
 * to the channel and nobody is notified, from any door.
 *
 * The one place an answer does reach a channel is outside everything this
 * spec reads: `../ask-post/ask-post.service.ts`, a separate request the asker
 * makes on an answer they already have, which calls no model (§ Posting an
 * answer to the channel).
 *
 * What asking runs is the route (`ask.controller.ts`), the answer lane (this
 * folder) and the request lane (`../act`), which only ever proposes a card.
 * Confirming a card is a different request, through the ordinary services.
 *
 * Two checks, both on the sources rather than on one question, so they also
 * fail the day someone wires a chat write into Ask for a different reason:
 *
 * 1. None of those files imports a module that writes a chat message or a
 *    notification.
 * 2. Every call they make on a service or a store they hold is on the list
 *    below. The first check alone is not enough: the lanes hold services
 *    (`TaskService`, `PointsService`, `AiSuggestionService`) that can post
 *    or notify from their own methods, so a new call into one of those
 *    would add no import. A new call fails here until someone reads what it
 *    does and lists it.
 *
 * What this does not see: a call made through a local alias of a service,
 * and what a listed method does inside. The tool loop runs a tool through
 * such an alias (`tool.run`), so what keeps a tool from writing is the tool's
 * own file, which is read here like every other: an agent tool is a class
 * under `agent/`, and each call it makes on what it holds must be listed. The one listed method that can
 * notify is `suggestions.proposeBatch`, and `act.service.spec.ts` ("pushes
 * nobody") pins that Act calls it with nobody to notify.
 */
const SERVICES = join(__dirname, '..');
const CONTROLLERS = join(
  __dirname,
  '..',
  '..',
  '..',
  'interface',
  'controllers',
);

/** The modules that can create, edit or delete a chat message, or notify. */
const WRITERS = [
  /\/chat\.service'/,
  /\/chat-thread\.service'/,
  /\/chat-form\.service'/,
  /\/chat-reaction\.service'/,
  /chat\.repository\.interface'/,
  /chat-thread\.repository\.interface'/,
  /chat-push-dispatch\.repository\.interface'/,
  /\/system-message/,
  /\/notification\.service'/,
  /notification\.repository\.interface'/,
];

/**
 * Every `this.<held>.<method>(` call the route and the lanes make, as
 * `held.method`. Before adding one, read the method: it must not create,
 * edit or delete a chat message, and must not notify anyone.
 */
const CALLS = new Set([
  // Reads of the chapter's records.
  'attendance.getAttendance',
  'corpus.indexedAmong',
  'events.findByChapter',
  'events.findById',
  'invoices.findByUser',
  'meetings.listPostedSince',
  'members.findByUserAndChapter',
  'members.findProfilesByChapter',
  'members.findRosterByChapter',
  'points.getLeaderboard',
  'points.getUserSummary',
  'rbac.findByChapter',
  'rbac.getEffectivePermissions',
  'retrieval.retrieve',
  'roles.findByChapterAndSystemKey',
  'tasks.findById',
  'tasks.list',
  'users.findDisplayIdentitiesByIds',
  // Consent, permission and the lanes' own plumbing.
  'act.availableActions',
  // A card from the tool loop: `ActService.proposePlanned`, which saves a
  // proposal for the asker alone (`act-agent-tools.ts`).
  'act.proposePlanned',
  'actService.act',
  'askService.ask',
  'askService.assertMayAsk',
  // What the member had open, looked up as them (`AskFromService`).
  'from.read',
  'consent.check',
  'consent.getConsentState',
  'consent.onConsentWithdrawn',
  'conversation.converse',
  // The officer's diagnostics routes, and the opening examples (in the
  // route, `suggestions` is `AskSuggestionsService`, which reads).
  'diagnostics.start',
  'diagnostics.stop',
  'diagnostics.view',
  'suggestions.suggest',
  'people.resolve',
  'tools.filter',
  'proposeTools.filter',
  // The tool loop (epic #4898): which reads to offer, and the loop itself,
  // which runs only what it was offered (`agent/agent-loop.service.ts`).
  'agentTools.filter',
  'loop.run',
  // The turn's trace (#4902): names, sizes and counts, and no text.
  'trace.record',
  // The agent's chapter tools (#4901, `agent/tools-chapter/`): reads of
  // people, tasks, events, attendance, points, hours and dues, each through
  // the service its own page's route calls. The ones above that these tools
  // also make are not repeated.
  'attendance.getMyAttendance',
  'attendance.getMyAttendanceForEvents',
  'excuses.getMine',
  'groups.list',
  'rbac.getAlumniRoleId',
  'service.findByChapterFiltered',
  'service.leaderboard',
  'standing.getStanding',
  // The agent's conversation tools (#4900, `agent/tools-conversation/`):
  // reads of channels, messages, documents and minutes, as the asker.
  'catchUp.readStretch',
  'catchUp.readableAmong',
  'channelReads.list',
  'channelReads.unreadCounts',
  'meetings.get',
  'meetings.list',
  'retrieval.readSource',
  'scope.findChannel',
  'scope.findMember',
  'scope.openChannels',
  'search.searchMessagesIn',
  // The trace of a turn and its thumbs (#4902, `observe/`): rows about the
  // turn with no text in them, and their removal. No message, no notice.
  'traces.deleteByUser',
  'traces.deleteExpired',
  'traces.deleteFeedback',
  'traces.deleteTrace',
  'traces.findFeedback',
  'traces.findForAsker',
  'traces.insertTrace',
  'traces.lastStartedAt',
  'traces.upsertFeedback',
  // The model.
  'gateway.generateObject',
  'gateway.streamAgentRound',
  'gateway.streamCited',
  // What asking writes: a proposal card for the asker (nobody is notified),
  // the diagnostics window's own rows, its audit entries, and the count.
  'analytics.track',
  'auditLog.record',
  'diagnostics.keep',
  'store.deleteExchangesByUser',
  'store.deleteExpiredWindows',
  'store.deleteWindow',
  'store.findWindow',
  'store.insertExchange',
  'store.openWindow',
  'suggestions.proposeBatch',
  'suggestions.withdrawSource',
  // Logging.
  'logger.debug',
  'logger.error',
  'logger.log',
  'logger.warn',
]);

/** Every source under `dir`, its folders included: the agent's tools live in them. */
function sourcesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourcesIn(join(dir, entry.name))
      : entry.name.endsWith('.ts') && !entry.name.includes('.spec.')
        ? [join(dir, entry.name)]
        : [],
  );
}

describe('Asking never posts to a channel or notifies (#4713)', () => {
  const sources = [
    ...sourcesIn(join(SERVICES, 'ask')),
    ...sourcesIn(join(SERVICES, 'act')),
    join(CONTROLLERS, 'ask.controller.ts'),
  ];
  const named = sources.map((path) => path.slice(path.lastIndexOf('/') + 1));

  it('has sources to read', () => {
    expect(named).toContain('ask.service.ts');
    expect(named).toContain('ask-conversation.service.ts');
    expect(named).toContain('agent-loop.service.ts');
    expect(named).toContain('agent-turn-trace.ts');
    expect(named).toContain('act.service.ts');
    expect(named).toContain('ask.controller.ts');
  });

  it.each(sources.map((path, index) => [named[index], path]))(
    '%s imports nothing that writes a chat message or a notification',
    (_name, path) => {
      const imports = readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => /\bfrom '/.test(line) || /^import '/.test(line));
      for (const writer of WRITERS) {
        expect(imports.filter((line) => writer.test(line))).toEqual([]);
      }
    },
  );

  it.each(sources.map((path, index) => [named[index], path]))(
    '%s calls only the listed methods on what it holds',
    (_name, path) => {
      const calls = [
        ...readFileSync(path, 'utf8').matchAll(
          /\bthis\s*\.\s*(\w+)\s*\.\s*(\w+)\s*\(/g,
        ),
      ].map((match) => `${match[1]}.${match[2]}`);
      expect(calls.filter((call) => !CALLS.has(call))).toEqual([]);
    },
  );

  it('lists no call the lanes no longer make', () => {
    const made = new Set(
      sources.flatMap((path) =>
        [
          ...readFileSync(path, 'utf8').matchAll(
            /\bthis\s*\.\s*(\w+)\s*\.\s*(\w+)\s*\(/g,
          ),
        ].map((match) => `${match[1]}.${match[2]}`),
      ),
    );
    const logging = (call: string) => call.startsWith('logger.');
    expect(
      [...CALLS].filter((call) => !made.has(call) && !logging(call)),
    ).toEqual([]);
  });
});
