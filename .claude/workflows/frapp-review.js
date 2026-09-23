export const meta = {
  name: 'frapp-review',
  description:
    "/diff-review's find and verify phases: bundled diff-finders, dedup, one claim-verifier per candidate and a second only on REFUTED",
  whenToUse:
    'Only from the diff-review skill (Phases 1-2), which resolves the pinned SHAs and passes them as args. Not a standalone review.',
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
// args: { base, head }             pinned commit SHAs (required)
//       mode: 'full' | 'delta'      delta = re-review of the commits since the last reviewed one
//       branchBase                  delta only: the SHA the branch forked from
//       level: 'medium' | 'high' | 'xhigh'   full only, default 'high'
//       ultracode: true             full only: forces xhigh and adds the acceptance-and-tests finder
//       acceptance                  optional acceptance criteria for that finder
//       changedLines                full only: under 150 merges the finders into two
//       dirty: true                 the review also covers `git diff HEAD`

const A = args || {}
const SHA = /^[0-9a-f]{7,40}$/
if (!SHA.test(String(A.base || '')) || !SHA.test(String(A.head || ''))) {
  throw new Error('frapp-review needs args.base and args.head as commit SHAs; resolve them once, never pass a ref like origin/main')
}
const MODE = A.mode === 'delta' ? 'delta' : 'full'
if (MODE === 'delta' && !SHA.test(String(A.branchBase || ''))) {
  throw new Error('frapp-review delta mode needs args.branchBase, the SHA the branch forked from')
}
const ULTRA = MODE === 'full' && A.ultracode === true
const LEVEL = MODE === 'delta' ? 'delta' : ULTRA ? 'xhigh' : ['medium', 'high', 'xhigh'].includes(A.level) ? A.level : 'high'
const SMALL = MODE === 'full' && typeof A.changedLines === 'number' && A.changedLines < 150

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

const SCOPE =
  MODE === 'full'
    ? `the diff \`git diff ${A.base} ${A.head}\`${A.dirty ? ', plus the uncommitted changes in `git diff HEAD`' : ''}`
    : `the changes since the last reviewed commit: \`git diff ${A.base} ${A.head} -- $(git diff --name-only ${A.branchBase} ${A.head})\`. ` +
      `For context only, the whole branch is \`git diff ${A.branchBase} ${A.head}\`. Report defects in those changes, or ones they create with the rest of the branch`

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
  const tree = b.worktree
    ? `You run in your own git worktree. Check that \`git rev-parse HEAD\` is ${A.head} and say so in a candidate-free result if it isn't. ` +
      'You may mutate source there to prove whether a test bites, but revert every mutation before you return, and report repo-relative paths.'
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

const norm = (file) => String(file).replace(/^\.\//, '')

// Streaming dedup: JS runs each stage callback to completion, so check-and-set on `seen` can't race.
function admit(candidates, source) {
  const fresh = []
  for (const c of candidates) {
    const key = `${norm(c.file)}:${c.line}`
    const prior = seen.get(key)
    if (prior) {
      prior.alsoFlaggedBy.push(`${source}: ${c.angle} — ${c.summary}`)
      merged++
      continue
    }
    const rec = { ...c, file: norm(c.file), source, alsoFlaggedBy: [] }
    seen.set(key, rec)
    fresh.push(rec)
  }
  return fresh
}

async function verify(rec) {
  const claim =
    `Finding: ${rec.file}:${rec.line}: ${rec.summary}\nFailure scenario: ${rec.failure_scenario}\n` +
    `Found by the "${rec.angle}" angle while reviewing ${SCOPE}. ${PINNED}`
  const label = `${rec.file.split('/').pop()}:${rec.line}`
  verifiers++
  const first = await agent(
    `Try to disprove this review finding.\n\n${claim}\n\nLens: reproduce. Trace the stated failure scenario through the code at ${A.head} and decide whether it actually happens.`,
    { agentType: 'claim-verifier', effort: EFFORT.verifier, schema: VERDICT, phase: 'Verify', label: `verify:${label}` },
  )
  if (!first) {
    unverified.push({ ...rec, missing: 'first verdict' })
    return
  }
  if (first.verdict !== 'REFUTED') {
    kept.push({ ...rec, ...first, escalated: false })
    return
  }
  escalations++
  verifiers++
  const second = await agent(
    `Try to disprove this review finding.\n\n${claim}\n\nLens: material. Decide whether this location has a real defect a reviewer should act on, even if the stated scenario is inexact. ` +
      'Return REFUTED only when nothing here needs changing.',
    { agentType: 'claim-verifier', effort: EFFORT.escalation, schema: VERDICT, phase: 'Verify', label: `verify2:${label}` },
  )
  if (!second) {
    unverified.push({ ...rec, missing: 'second verdict after REFUTED', firstVerdict: first })
    return
  }
  if (second.verdict !== 'REFUTED') kept.push({ ...rec, ...second, escalated: true, firstVerdict: first })
  else refuted.push({ ...rec, escalated: true, evidence: [first.evidence, second.evidence] })
}

function onFinder(res, source, cap, angles) {
  if (!res) {
    finderFailures.push({ source, angles })
    log(`${source} returned nothing: run its angles (${angles.join('; ')}) inline before reporting`)
    return []
  }
  if (res.candidates.length >= cap) {
    cappedFinders.push(source)
    log(`${source} hit its cap of ${cap}; it may have had more`)
  }
  return admit(res.candidates, source)
}

log(`${MODE} review at ${LEVEL}: ${BUNDLES.length} finders${SWEEP_CAP ? ' + gap sweep' : ''}${SMALL ? ' (small diff)' : ''}`)

phase('Find')
await pipeline(
  BUNDLES,
  (b) => {
    finders++
    const opts = { agentType: 'diff-finder', effort: EFFORT.finder, schema: candidatesSchema(b.cap), phase: 'Find', label: `find:${b.key}` }
    if (b.worktree) opts.isolation = 'worktree'
    return agent(finderPrompt(b), opts)
  },
  (res, b) => parallel(onFinder(res, `find:${b.key}`, b.cap, b.angles).map((rec) => () => verify(rec))),
)

if (SWEEP_CAP) {
  phase('Sweep')
  finders++
  const survivors = kept.map((k) => `- ${k.file}:${k.line}: ${k.summary}`).join('\n') || '(none)'
  const res = await agent(
    `Review ${SCOPE}. ${PINNED}\n\nOther finders have covered every angle in .claude/skills/diff-review/SKILL.md, and these findings survived verification:\n${survivors}\n\n` +
      `Your angle: what the other angles missed. Don't repeat the list. Return at most ${SWEEP_CAP} new candidates, most severe first, with angle "Gap sweep". ` +
      'You share the working tree with other agents: never edit, stash, check out, or reset anything.',
    { agentType: 'diff-finder', effort: EFFORT.finder, schema: candidatesSchema(SWEEP_CAP), phase: 'Sweep', label: 'find:gap-sweep' },
  )
  await parallel(onFinder(res, 'find:gap-sweep', SWEEP_CAP, ['Gap sweep']).map((rec) => () => verify(rec)))
}

const counts = { finders, candidates: seen.size, duplicatesMerged: merged, verifiers, escalations, agents: finders + verifiers }
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
