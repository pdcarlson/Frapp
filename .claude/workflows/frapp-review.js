export const meta = {
  name: 'frapp-review',
  description:
    "/diff-review's workflow round: bundled diff-finders, then one claim-verifier per flagged line and a second lens only on REFUTED",
  whenToUse:
    "Only from the diff-review skill, when scripts/diff-review-scope.mjs says review: 'workflow'; pass its output as args. Not a standalone review.",
  phases: [
    { title: 'Find', detail: 'bundled diff-finders, in parallel' },
    { title: 'Verify', detail: 'one claim-verifier per flagged line; a second lens only for what it refutes' },
  ],
}

// This file owns the workflow round's mechanics: which angles share a finder, candidate caps,
// grouping, and the verify rule. .claude/skills/diff-review/SKILL.md owns when it runs and what
// happens to its results; angles.md beside it owns what each angle means. Why this shape:
// spec/architecture/adr/adr-23.md.
//
// args: the JSON line `node scripts/diff-review-scope.mjs` prints
//         { mode: 'full' | 'delta', base, head, branchBase, root, changedLines, dirty }
//       plus acceptance: the issue's acceptance criteria, when there is an issue (full only)

const A = args || {}
const SHA = /^[0-9a-f]{7,40}$/
if (A.mode !== 'full' && A.mode !== 'delta') {
  throw new Error(`frapp-review: scope mode is "${A.mode}"; only full and delta get a review`)
}
for (const key of ['base', 'head', 'branchBase']) {
  if (!SHA.test(String(A[key] || ''))) throw new Error(`frapp-review needs ${key} as a SHA: pass the output of scripts/diff-review-scope.mjs`)
}
const FULL = A.mode === 'full'
// Only a measured line count can shrink a full review; a missing or zero count means "not known".
const SMALL = !FULL || (typeof A.changedLines === 'number' && A.changedLines > 0 && A.changedLines < 150)

const CHANGES = ['Hunk scan', 'Language pitfalls']
const DEPENDENTS = ['Removed behavior', 'Caller/callee tracing']
const DOCS_REUSE = ['Docs', 'Reuse, simplification, efficiency']
const INVARIANTS = ['Tenant isolation', 'Permission enforcement', 'Migration safety', 'Secrets', 'Tracker', 'Verification honesty']

const BUNDLES = SMALL
  ? [
      { key: 'code', angles: [...CHANGES, ...DEPENDENTS], cap: 8 },
      { key: 'docs-invariants', angles: [...DOCS_REUSE, ...INVARIANTS], cap: 8 },
    ]
  : [
      { key: 'changes', angles: CHANGES, cap: 8 },
      { key: 'dependents', angles: DEPENDENTS, cap: 8 },
      { key: 'docs-reuse', angles: DOCS_REUSE, cap: 8 },
      { key: 'invariants', angles: INVARIANTS, cap: 8 },
    ]
// A branch's first review also checks what it set out to do, and whether its tests would notice.
if (FULL) BUNDLES.push({ key: 'acceptance-tests', angles: ['Acceptance criteria', 'Test adequacy'], cap: 6, worktree: true })

const DIRTY = A.dirty ? ', plus the uncommitted changes in `git diff HEAD`' : ''
const SCOPE = FULL
  ? `the diff \`git diff ${A.base} ${A.head}\`${DIRTY}`
  : `the changes since the last review, \`git diff ${A.base} ${A.head}\`${DIRTY}. ` +
    `For context only, the whole branch is \`git diff ${A.branchBase} ${A.head}\`. Report defects in those changes, or ones they create with the rest of the branch`
const CODE_AT = A.dirty ? `the working tree (commit ${A.head} plus its uncommitted changes)` : `commit ${A.head}`
const PINNED = 'The SHAs are pinned: use them as given and never re-resolve `origin/main`, which a background fetch can move mid-review.'

// Every agent() call sets effort. Without it an agent inherits the session's effort, which
// ultracode pins to xhigh (.claude/skills/multi-agent/SKILL.md § Effort).
const EFFORT = { finder: 'high', verifier: 'medium', escalation: 'high' }

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

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          finding: { type: 'integer', description: 'The number the finding has in the prompt' },
          verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
          evidence: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['finding', 'verdict', 'evidence', 'confidence'],
      },
    },
  },
  required: ['verdicts'],
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
  const criteria = b.worktree
    ? A.acceptance
      ? `\n\nAcceptance criteria to check the diff against:\n${A.acceptance}`
      : '\n\nNo acceptance criteria were passed: check the diff against what its commit messages say it does.'
    : ''
  return (
    `Review ${SCOPE}. ${PINNED}\n\n` +
    `Your angles: ${b.angles.join('; ')}. Their definitions are in .claude/skills/diff-review/angles.md; read the ones you hold before you start. ` +
    'Cover every angle you hold, and tag each candidate with the angle that found it. Other finders hold the remaining angles.\n\n' +
    `Return at most ${b.cap} candidates, most severe first. ${tree}${criteria}`
  )
}

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

const kept = []
const refuted = []
const unverified = []
const finderFailures = []
const cappedFinders = []
let received = 0
let verifiers = 0
let escalations = 0

log(`${A.mode} review: ${BUNDLES.length} finders${SMALL ? ' (small)' : ''}`)
phase('Find')
const found = await parallel(
  BUNDLES.map((b) => () => {
    const opts = { agentType: 'diff-finder', effort: EFFORT.finder, schema: candidatesSchema(b.cap), phase: 'Find', label: `find:${b.key}` }
    if (b.worktree) opts.isolation = 'worktree'
    return safeAgent(finderPrompt(b), opts)
  }),
)

// A barrier on purpose: candidates at the same file:line, from any finder, go to one verifier
// together, so nothing is verified twice and two defects at one line each get their own verdict.
const lines = new Map()
BUNDLES.forEach((b, i) => {
  const res = found[i]
  const source = `find:${b.key}`
  if (!res || res.problem) {
    finderFailures.push({ source, angles: b.angles, problem: res ? res.problem : 'returned nothing' })
    log(`${source} ${res ? `could not review all of it: ${res.problem}` : 'returned nothing'}. Cover its angles (${b.angles.join('; ')}) inline before reporting`)
    if (!res) return
  }
  received += res.candidates.length
  if (res.candidates.length >= b.cap) {
    cappedFinders.push(source)
    log(`${source} hit its cap of ${b.cap}; it may have had more`)
  }
  for (const c of res.candidates) {
    const f = { ...c, file: norm(c.file), source }
    const key = `${f.file}:${f.line}`
    lines.set(key, [...(lines.get(key) || []), f])
  }
})

async function judge(findings, lens, effort, label) {
  verifiers++
  const list = findings
    .map((f, i) => `${i + 1}. ${f.file}:${f.line} (${f.angle}): ${f.summary}\n   Failure scenario: ${f.failure_scenario}`)
    .join('\n')
  const ask =
    lens === 'reproduce'
      ? `Lens: reproduce. Trace each stated failure scenario through ${CODE_AT} and decide whether it actually happens.`
      : `Lens: material. Looking at ${CODE_AT}, decide whether each finding points at a real defect a reviewer should act on, even if its stated scenario is inexact. ` +
        'Return REFUTED only when nothing there needs changing.'
  const res = await safeAgent(
    `Try to disprove ${findings.length > 1 ? 'each of these review findings. They share a line, but judge each on its own' : 'this review finding'}; ` +
      `return one verdict per finding, numbered as below.\n\n${list}\n\nThey come from a review of ${SCOPE}. ${PINNED}\n\n${ask}`,
    { agentType: 'claim-verifier', effort, schema: VERDICTS, phase: 'Verify', label },
  )
  return findings.map((_, i) => (res ? res.verdicts.find((v) => v.finding === i + 1) : null) || null)
}

async function verifyLine(key, findings) {
  const label = key.split('/').pop()
  const first = await judge(findings, 'reproduce', EFFORT.verifier, `verify:${label}`)
  const escalate = []
  findings.forEach((f, i) => {
    const v = first[i]
    if (!v) unverified.push({ ...f, missing: 'first verdict' })
    else if (v.verdict !== 'REFUTED') kept.push({ ...f, verdict: v.verdict, evidence: v.evidence, confidence: v.confidence, escalated: false })
    else escalate.push(f)
  })
  if (!escalate.length) return
  // The second lens never sees the first verdict; a finding is dropped only when both refute it.
  escalations += escalate.length
  const second = await judge(escalate, 'material', EFFORT.escalation, `verify2:${label}`)
  escalate.forEach((f, i) => {
    const v = second[i]
    if (!v) unverified.push({ ...f, missing: 'second verdict after REFUTED' })
    else if (v.verdict !== 'REFUTED') kept.push({ ...f, verdict: v.verdict, evidence: v.evidence, confidence: v.confidence, escalated: true })
    else refuted.push({ file: f.file, line: f.line, summary: f.summary })
  })
}

phase('Verify')
await parallel([...lines].map(([key, findings]) => () => verifyLine(key, findings)))

const counts = { finders: BUNDLES.length, candidates: received, lines: lines.size, verifiers, escalations, agents: BUNDLES.length + verifiers }
log(
  `${counts.agents} agents: ${counts.finders} finders, ${verifiers} verifiers (${escalations} findings escalated); ` +
    `${kept.length} kept, ${refuted.length} refuted, ${unverified.length} unverified`,
)

return { mode: A.mode, base: A.base, head: A.head, counts, kept, refuted, unverified, finderFailures, cappedFinders }
