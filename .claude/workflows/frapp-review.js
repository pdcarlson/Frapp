export const meta = {
  name: 'frapp-review',
  description:
    "/diff-review's find and verify phases: bundled diff-finders, dedup, one claim-verifier per candidate and a second only on REFUTED",
  whenToUse:
    'Only from the diff-review skill (Phases 1-2), which passes the output of scripts/diff-review-scope.mjs as args. Not a standalone review.',
  phases: [
    { title: 'Find', detail: 'bundled diff-finders; each candidate is deduped and verified as it arrives' },
    { title: 'Verify', detail: 'one claim-verifier per new candidate; a second lens only on REFUTED' },
    { title: 'Sweep', detail: 'xhigh full reviews only: one finder for what the others missed' },
  ],
}

// This file owns the review's mechanics: which angles share a finder, candidate caps, the gap
// sweep, dedup, and the verify/escalate rule. .claude/skills/diff-review/SKILL.md owns what each
// angle means, how to call this workflow, and Phases 0, 3 and 4. Why the shape is this one:
// spec/architecture/adr/adr-23.md.
//
// args: the JSON line `node scripts/diff-review-scope.mjs` prints
//         { mode: 'full' | 'delta', base, head, branchBase, root, changedLines, dirty }
//       plus level: 'medium' | 'high' | 'xhigh'   full only, default 'high'
//            ultracode: true                      full only: forces xhigh, adds the acceptance-and-tests finder
//            acceptance                           optional acceptance criteria for that finder

const A = args || {}
const SHA = /^[0-9a-f]{7,40}$/
if (A.mode === 'none' || A.mode === 'empty') {
  throw new Error(`frapp-review: scope mode is "${A.mode}", so there is nothing to review`)
}
if (!SHA.test(String(A.base || '')) || !SHA.test(String(A.head || ''))) {
  throw new Error('frapp-review needs base and head as commit SHAs: pass the output of scripts/diff-review-scope.mjs')
}
const MODE = A.mode === 'delta' ? 'delta' : 'full'
if (MODE === 'delta' && !SHA.test(String(A.branchBase || ''))) {
  throw new Error('frapp-review delta mode needs branchBase, the SHA the branch forked from')
}
const ULTRA = MODE === 'full' && A.ultracode === true
const LEVEL = MODE === 'delta' ? 'delta' : ULTRA ? 'xhigh' : ['medium', 'high', 'xhigh'].includes(A.level) ? A.level : 'high'
// Only a measured line count can shrink a full review; a missing or zero count means "not known".
const SMALL = MODE === 'full' && typeof A.changedLines === 'number' && A.changedLines > 0 && A.changedLines < 150

const CHANGES = ['Hunk scan', 'Language pitfalls']
const DEPENDENTS = ['Removed behavior', 'Caller/callee tracing']
const DOCS_REUSE = ['Docs', 'Reuse, simplification, efficiency']
const INVARIANTS = ['Tenant isolation', 'Permission enforcement', 'Migration safety', 'Secrets', 'Tracker', 'Verification honesty']
const EXTRA = ['Acceptance criteria', 'Test adequacy']

function bundlesFor() {
  if (MODE === 'delta' || SMALL) {
    const cap = MODE === 'delta' ? 6 : 8
    return [
      { key: 'code', angles: [...CHANGES, ...DEPENDENTS], cap },
      { key: 'docs-invariants', angles: [...DOCS_REUSE, ...INVARIANTS], cap },
    ]
  }
  if (LEVEL === 'medium') {
    return [
      { key: 'code', angles: [...CHANGES, ...DEPENDENTS], cap: 8 },
      { key: 'docs-reuse', angles: DOCS_REUSE, cap: 8 },
      { key: 'invariants', angles: INVARIANTS, cap: 8 },
    ]
  }
  return [
    { key: 'changes', angles: CHANGES, cap: 8 },
    { key: 'dependents', angles: DEPENDENTS, cap: 8 },
    { key: 'docs-reuse', angles: DOCS_REUSE, cap: 8 },
    { key: 'invariants', angles: INVARIANTS, cap: 8 },
  ]
}

const BUNDLES = bundlesFor()
if (ULTRA) BUNDLES.push({ key: 'acceptance-tests', angles: EXTRA, cap: 6, worktree: true })
const SWEEP_CAP = MODE === 'full' && LEVEL === 'xhigh' ? 8 : 0

const DIRTY = A.dirty ? ', plus the uncommitted changes in `git diff HEAD`' : ''
// A delta never spans a merge: the scope script turns that into a full review.
const SCOPE =
  MODE === 'full'
    ? `the diff \`git diff ${A.base} ${A.head}\`${DIRTY}`
    : `the changes since the last reviewed commit, \`git diff ${A.base} ${A.head}\`${DIRTY}. ` +
      `For context only, the whole branch is \`git diff ${A.branchBase} ${A.head}\`. Report defects in those changes, or ones they create with the rest of the branch`
const CODE_AT = A.dirty ? `the working tree (commit ${A.head} plus its uncommitted changes)` : `commit ${A.head}`

// Every agent() call sets effort. Without it an agent inherits the session's effort, which
// ultracode pins to xhigh (.claude/skills/multi-agent/SKILL.md § Effort).
const EFFORT = { finder: 'high', verifier: 'medium', escalation: 'high' }

const PINNED = 'The SHAs are pinned: use them as given and never re-resolve `origin/main`, which a background fetch can move mid-review.'

const candidatesSchema = (cap) => ({
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      maxItems: cap,
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          angle: { type: 'string' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string' },
        },
        required: ['file', 'line', 'angle', 'summary', 'failure_scenario'],
      },
    },
    problem: { type: 'string', description: 'Set when you could not review some or all of your angles; say what stopped you. Still return the candidates you found.' },
  },
  required: ['candidates'],
})

const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
    evidence: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['verdict', 'evidence', 'confidence'],
}

function finderPrompt(b) {
  // A workflow worktree starts at origin/<default-branch>, not at the reviewed commit, so the
  // finder moves it there itself; worktrees share the object store, so the commit is present.
  const tree = b.worktree
    ? `You run in your own git worktree, which starts at origin/main, not at the reviewed commit. First note \`git rev-parse HEAD\`, then run ` +
      `\`git checkout -q --detach ${A.head}\` and confirm HEAD is ${A.head}; if you can't, set \`problem\` and return no candidates. ` +
      'You may mutate source there to prove whether a test bites. Before you return, revert every mutation and check out the HEAD you noted, so the harness can remove the worktree. ' +
      `Report paths relative to the repo root.${A.dirty ? ' Your worktree has only committed code; the uncommitted changes are not in it.' : ''}`
    : 'You share the working tree with other agents: never edit, stash, check out, or reset anything.'
  const criteria = b.key === 'acceptance-tests' && A.acceptance ? `\n\nAcceptance criteria to check the diff against:\n${A.acceptance}` : ''
  return (
    `Review ${SCOPE}. ${PINNED}\n\n` +
    `Your angles: ${b.angles.join('; ')}. Their definitions are in .claude/skills/diff-review/SKILL.md; read the ones you hold before you start. ` +
    'Cover every angle you hold, and tag each candidate with the angle that found it. Other finders hold the remaining angles.\n\n' +
    `Return at most ${b.cap} candidates, most severe first. ${tree}${criteria}`
  )
}

const seen = new Map()
const kept = []
const refuted = []
const unverified = []
const finderFailures = []
const cappedFinders = []
let finders = 0
let verifiers = 0
let escalations = 0
let merged = 0
let received = 0

// agent() returns null for a skipped or dead agent, but can also throw (an unknown agent type, a
// denied tool pool). Either way the check didn't run, and the caller must be able to see that.
async function safeAgent(prompt, opts) {
  try {
    return await agent(prompt, opts)
  } catch (err) {
    log(`${opts.label} threw: ${err && err.message ? err.message : err}`)
    return null
  }
}

const ROOT = A.root ? String(A.root).replace(/\/+$/, '') + '/' : null
function norm(file) {
  let f = String(file).replace(/^.*\/\.claude\/worktrees\/[^/]+\//, '')
  if (ROOT && f.startsWith(ROOT)) f = f.slice(ROOT.length)
  return f.replace(/^\.\//, '')
}

// Streaming dedup by file:line. JS runs each stage callback to completion, so check-and-set on
// `seen` can't race. `seen` holds the one live candidate per line. A duplicate of a kept candidate
// rides along as `alsoFlaggedBy`; a duplicate of a pending one waits in its `dups`. When a candidate
// is refuted or unverified, its next duplicate may be a different defect at the same line, so that
// one takes over the line and is verified, carrying the rest: duplicates are verified one at a time,
// and only while each one before them fails.
function admit(candidates, source) {
  const fresh = []
  for (const c of candidates) {
    const key = `${norm(c.file)}:${c.line}`
    const rec = { ...c, file: norm(c.file), key, source, status: 'pending', alsoFlaggedBy: [], dups: [] }
    const prior = seen.get(key)
    if (prior && prior.status === 'kept') {
      prior.alsoFlaggedBy.push(`${source}: ${c.angle} — ${c.summary}`)
      merged++
    } else if (prior && prior.status === 'pending') {
      prior.dups.push(rec)
      merged++
    } else {
      seen.set(key, rec)
      fresh.push(rec)
    }
  }
  return fresh
}

async function settle(rec, status, extra) {
  rec.status = status
  const { dups, key, ...out } = rec
  if (status === 'kept') {
    for (const d of dups) rec.alsoFlaggedBy.push(`${d.source}: ${d.angle} — ${d.summary}`)
    kept.push({ ...out, ...extra })
    return
  }
  ;(status === 'refuted' ? refuted : unverified).push({ ...out, ...extra })
  const [next, ...rest] = dups
  if (!next) return
  merged--
  next.dups.push(...rest)
  seen.set(key, next)
  await verify(next)
}

async function verify(rec) {
  const claim =
    `Finding: ${rec.file}:${rec.line}: ${rec.summary}\nFailure scenario: ${rec.failure_scenario}\n` +
    `Found by the "${rec.angle}" angle while reviewing ${SCOPE}. ${PINNED}`
  const label = `${rec.file.split('/').pop()}:${rec.line}`
  verifiers++
  const first = await safeAgent(
    `Try to disprove this review finding.\n\n${claim}\n\nLens: reproduce. Trace the stated failure scenario through ${CODE_AT} and decide whether it actually happens.`,
    { agentType: 'claim-verifier', effort: EFFORT.verifier, schema: VERDICT, phase: 'Verify', label: `verify:${label}` },
  )
  if (!first) return settle(rec, 'unverified', { missing: 'first verdict' })
  if (first.verdict !== 'REFUTED') return settle(rec, 'kept', { ...first, escalated: false })
  escalations++
  verifiers++
  const second = await safeAgent(
    `Try to disprove this review finding.\n\n${claim}\n\nLens: material. Looking at ${CODE_AT}, decide whether this location has a real defect a reviewer should act on, even if the stated scenario is inexact. ` +
      'Return REFUTED only when nothing here needs changing.',
    { agentType: 'claim-verifier', effort: EFFORT.escalation, schema: VERDICT, phase: 'Verify', label: `verify2:${label}` },
  )
  if (!second) return settle(rec, 'unverified', { missing: 'second verdict after REFUTED', firstVerdict: first })
  if (second.verdict !== 'REFUTED') return settle(rec, 'kept', { ...second, escalated: true, firstVerdict: first })
  return settle(rec, 'refuted', { escalated: true, evidence: [first.evidence, second.evidence] })
}

function onFinder(res, source, cap, angles) {
  if (!res || res.problem) {
    finderFailures.push({ source, angles, problem: res ? res.problem : 'returned nothing' })
    log(`${source} ${res ? `could not review all of it: ${res.problem}` : 'returned nothing'}. Cover its angles (${angles.join('; ')}) inline before reporting`)
    if (!res) return []
  }
  received += res.candidates.length
  if (res.candidates.length >= cap) {
    cappedFinders.push(source)
    log(`${source} hit its cap of ${cap}; it may have had more`)
  }
  return admit(res.candidates, source)
}

log(`${MODE} review at ${LEVEL}: ${BUNDLES.length} finders${SWEEP_CAP ? ' + gap sweep' : ''}${SMALL ? ' (small diff)' : ''}`)

phase('Find')
// pipeline() skips an item's later stages once a stage yields null, so the finder's result is
// wrapped: stage 2 must run even for a dead finder, or its failure would never be recorded.
await pipeline(
  BUNDLES,
  async (b) => {
    finders++
    const opts = { agentType: 'diff-finder', effort: EFFORT.finder, schema: candidatesSchema(b.cap), phase: 'Find', label: `find:${b.key}` }
    if (b.worktree) opts.isolation = 'worktree'
    return { res: await safeAgent(finderPrompt(b), opts) }
  },
  (out, b) => parallel(onFinder(out.res, `find:${b.key}`, b.cap, b.angles).map((rec) => () => verify(rec))),
)

if (SWEEP_CAP) {
  phase('Sweep')
  finders++
  const survivors = kept.map((k) => `- ${k.file}:${k.line}: ${k.summary}`).join('\n') || '(none)'
  const res = await safeAgent(
    `Review ${SCOPE}. ${PINNED}\n\nOther finders have covered every angle in .claude/skills/diff-review/SKILL.md, and these findings survived verification:\n${survivors}\n\n` +
      `Your angle: what the other angles missed. Don't repeat the list. Return at most ${SWEEP_CAP} new candidates, most severe first, with angle "Gap sweep". ` +
      'You share the working tree with other agents: never edit, stash, check out, or reset anything.',
    { agentType: 'diff-finder', effort: EFFORT.finder, schema: candidatesSchema(SWEEP_CAP), phase: 'Sweep', label: 'find:gap-sweep' },
  )
  await parallel(onFinder(res, 'find:gap-sweep', SWEEP_CAP, ['Gap sweep']).map((rec) => () => verify(rec)))
}

const counts = { finders, candidates: received, duplicatesMerged: merged, verifiers, escalations, agents: finders + verifiers }
log(
  `${counts.agents} agents: ${finders} finders, ${verifiers} verifiers (${escalations} escalated); ` +
    `${kept.length} kept, ${refuted.length} refuted, ${unverified.length} unverified, ${merged} duplicates merged`,
)

return {
  mode: MODE,
  level: LEVEL,
  base: A.base,
  head: A.head,
  counts,
  kept,
  refuted,
  unverified,
  finderFailures,
  cappedFinders,
}
