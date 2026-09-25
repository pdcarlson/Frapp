// The verdict both production backup-freshness watches share: is one job of
// Nightly Backup (`db-backup.yml`) recent, successful, and not hung?
//
// `production-backup-freshness.mjs` (the Postgres dump) and
// `production-backup-storage-freshness.mjs` (the Storage mirror) watch two
// jobs of the same workflow with the same rules, so the rules live here once
// and each script passes its own job name and windows. The constants stay in
// the scripts, where their source-text locks pin them. Rule tests:
// `scripts/ci/__tests__/backup-job-freshness.test.mjs`.
//
// THE RULES (the canonical statement; the docs and scripts link here)
// - Unreadable Actions responses are FAIL, never pass.
// - The newest run decides alone when its job succeeded (fresh within the
//   stale window, the one verdict that may close an open alert; FAIL when
//   older), when its job failed or timed out (FAIL the same day), when it is
//   hung past the hung window, and when the job is missing from a run that
//   ran (a renamed or deleted job must not green). GitHub reports a job
//   stopped by its `timeout-minutes` as `cancelled`, so a cancelled job that
//   ran on a runner for its whole timeout (within a minute below it, and not
//   far past it) counts as timed out. A job cancelled before any step ran,
//   such as one parked in `waiting`, never did.
// - Otherwise the newest run's job is in flight (queued, running, or
//   `waiting` on a deployment protection rule), or it was cancelled before its
//   timeout or skipped, or the run was cancelled or skipped before any job
//   was created. Then the verdict rests on the most recent earlier run in
//   which the job finished: a success within the stale window passes, and
//   anything else (a failure, a timeout, an older success, or no finished
//   run) is FAIL, so cancelling a retry can't hide a failed nightly. That
//   pass is never fresh, so it never closes an open alert, and the scripts
//   print it as a `::warning::` (`verdictLogLine`).
// - A re-run's cancelled or skipped job decides nothing and is FAIL:
//   `filter=latest` lists only the latest attempt, so an earlier attempt's
//   failure is hidden behind it. Cancelling a re-run must not hide a failed
//   nightly either.
// - The hung check comes first: an in-flight newest job past the hung window
//   is FAIL that day, whatever an earlier run holds. So a job suspended on a
//   reviewer gate passes (as a warning) only while its run is younger than
//   the hung window, and fails once it is older.
//
// Why the fallback to an earlier success (#2332): judging the newest run
// alone let an in-flight run return before the stale check, so a job parked
// in `waiting` greened the watch every night while nothing was backed up,
// since each night's new run reset the age the hung check measures. In the
// other direction, one cancelled dispatch raised a P1 against a job that had
// succeeded hours earlier, which teaches responders to distrust the alert.
// A job that ran and failed is not that case: #2332's acceptance list named
// "failed" alongside "cancelled", but a failed backup is the thing this alarm
// exists for, and letting an earlier success cover it meant an isolated
// failed night never raised the P1 at all.
//
// The earlier runs searched are the ones the scripts list: the
// `RUNS_PER_PAGE` newest on `main`. More runs than that inside the window
// could hide an earlier success; that fails closed, as a P1.

/** How many recent runs the scripts list; the earlier-success search sees no further back. */
export const RUNS_PER_PAGE = 30;

const IN_FLIGHT_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "pending",
  "requested",
]);

// Conclusions that defer the verdict to an earlier run: nothing was attempted
// and failed. On a run with no job rows, these are a dispatch cancelled while
// pending on the concurrency group; on a job, a skipped backup or one
// cancelled before its timeout (`finishedAttempt` catches the timeout first).
const BACKED_CONCLUSIONS = new Set(["cancelled", "skipped"]);

/** `ok` greens the run. `fresh` is the only verdict that may close the alert. */
export function jobVerdict(ok, fresh, reason) {
  return { ok, fresh: Boolean(ok && fresh), reason };
}

/**
 * The line a script prints for a verdict: green when fresh, a `::warning::`
 * when it passes on an earlier success, an `::error::` when it fails. Both
 * scripts print through this, so a pass that isn't fresh can't look green.
 */
export function verdictLogLine(verdict) {
  if (verdict.fresh) return `✅ ${verdict.reason}`;
  if (verdict.ok) return `::warning::${verdict.reason}`;
  return `::error::${verdict.reason}`;
}

/** Newest first, by `created_at`. */
export function runsNewestFirst(runs) {
  return [...runs].sort(
    (a, b) => Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0),
  );
}

function ageMs(iso, now) {
  const at = Date.parse(iso ?? "");
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : now - at;
}

function hours(ms) {
  return `${Math.round(ms / (60 * 60 * 1000))}h`;
}

function readable(fetched) {
  return Boolean(fetched) && fetched.status === 200 && Array.isArray(fetched.jobs);
}

function findJob(jobs, jobName) {
  return jobs.find((entry) => entry && entry.name === jobName);
}

// A cancelled job whose steps ran from TIMEOUT_SLACK_MS below its timeout to
// TIMEOUT_OVERRUN_MS past it was stopped by it. The overrun bound and the
// step-based start keep a job cancelled while it waited (no runner, so no
// steps; `started_at` then marks when it was queued) from reading as one.
export const TIMEOUT_SLACK_MS = 60 * 1000;
export const TIMEOUT_OVERRUN_MS = 15 * 60 * 1000;

function ranToTimeout(job, timeoutMs) {
  if (Array.isArray(job.steps) && job.steps.length === 0) return false;
  const started = Date.parse(job.steps?.[0]?.started_at ?? job.started_at ?? "");
  const completed = Date.parse(job.completed_at ?? "");
  if (Number.isNaN(started) || Number.isNaN(completed)) return false;
  const ran = completed - started;
  return ran >= timeoutMs - TIMEOUT_SLACK_MS && ran <= timeoutMs + TIMEOUT_OVERRUN_MS;
}

function isRerun(run) {
  return Number(run?.run_attempt) > 1;
}

/**
 * How a finished job's attempt ended: "success", "failed" (a failure, a
 * timeout, a re-run's cancel or skip, or any conclusion an earlier success may
 * not cover), or null when it didn't finish an attempt (missing, in flight,
 * cancelled before its timeout, skipped). The one test the reader and the
 * evaluator both use, so they stop at the same run.
 */
export function finishedAttempt(job, timeoutMs, run) {
  if (!job || job.status !== "completed") return null;
  if (job.conclusion === "success") return "success";
  if (job.conclusion === "cancelled" && ranToTimeout(job, timeoutMs)) return "failed";
  if (BACKED_CONCLUSIONS.has(job.conclusion)) return isRerun(run) ? "failed" : null;
  return "failed";
}

function describeEnd(job, jobName, timeoutMs, run) {
  if (job.conclusion === "cancelled" && ranToTimeout(job, timeoutMs)) {
    return `${jobName} hit its ${Math.round(timeoutMs / 60000)}-minute timeout`;
  }
  const ended = `${jobName} concluded ${job.conclusion || "unknown"}`;
  if (BACKED_CONCLUSIONS.has(job.conclusion) && isRerun(run)) {
    return `${ended} on re-run attempt ${run.run_attempt}, which hides how the earlier attempt ended`;
  }
  return ended;
}

/**
 * Judge the newest run on its own. Returns `{ verdict }` when it decides, or
 * `{ backing }` (the reason to report) when the verdict rests on the earlier
 * runs (`backedBy`). The reader uses this to decide whether to read them.
 */
export function judgeNewest({ jobName, run, fetched, staleAfterMs, hungAfterMs, timeoutMs, now }) {
  if (!readable(fetched)) {
    return {
      verdict: jobVerdict(
        false,
        false,
        `${jobName} jobs unreadable (HTTP ${fetched?.status || "no response"})`,
      ),
    };
  }

  const hung = { verdict: jobVerdict(false, false, `${jobName} hung for more than ${hours(hungAfterMs)}`) };
  const job = findJob(fetched.jobs, jobName);
  if (!job) {
    if (IN_FLIGHT_STATUSES.has(run.status)) {
      if (ageMs(run.run_started_at || run.created_at, now) > hungAfterMs) return hung;
      return { backing: `${jobName} is in flight` };
    }
    if (BACKED_CONCLUSIONS.has(run.conclusion) && fetched.jobs.length === 0) {
      return { backing: `the newest run was ${run.conclusion} before ${jobName} started` };
    }
    return { verdict: jobVerdict(false, false, `${jobName} job is missing`) };
  }

  if (IN_FLIGHT_STATUSES.has(job.status)) {
    if (ageMs(job.started_at || run.created_at, now) > hungAfterMs) return hung;
    return { backing: `${jobName} is in flight` };
  }

  if (job.conclusion !== "success") {
    const ended = describeEnd(job, jobName, timeoutMs, run);
    if (finishedAttempt(job, timeoutMs, run) === "failed") return { verdict: jobVerdict(false, false, ended) };
    return { backing: ended };
  }

  if (ageMs(job.completed_at, now) > staleAfterMs) {
    return {
      verdict: jobVerdict(false, false, `last ${jobName} success is older than ${hours(staleAfterMs)}`),
    };
  }
  return { verdict: jobVerdict(true, true, `${jobName} succeeded within ${hours(staleAfterMs)}`) };
}

/**
 * The earlier runs that could hold a success inside the window: every run but
 * the newest whose `updated_at` is within it. A job completing updates its
 * run, and a re-run keeps the run's `created_at` but moves `updated_at`, so a
 * run not updated inside the window can't hold a success inside it. Runs
 * still in flight are kept: the jobs run in parallel, so the watched job can
 * finish while another is still running.
 */
export function candidateOlderRuns({ runs, staleAfterMs, now }) {
  return runsNewestFirst(runs)
    .slice(1)
    .filter((run) => ageMs(run.updated_at || run.created_at, now) <= staleAfterMs);
}

/**
 * A pass resting on an earlier success, or FAIL. Walks the earlier runs to
 * the most recent one in which the job finished an attempt, and judges that
 * attempt alone: a success within the window passes; a failure, a timeout or
 * an older success is FAIL. Never fresh: only the newest run's own success
 * may close an alert. A run the walk reaches with no entry in `jobsByRunId`,
 * or an unreadable one, is FAIL, because what it holds can't be ruled in or
 * out.
 */
function backedBy({ jobName, runs, jobsByRunId, staleAfterMs, timeoutMs, now, reason }) {
  const none = jobVerdict(false, false, `${reason}, and no ${jobName} success is within ${hours(staleAfterMs)}`);
  for (const run of candidateOlderRuns({ runs, staleAfterMs, now })) {
    const fetched = jobsByRunId.get(run.id);
    if (!readable(fetched)) {
      return jobVerdict(
        false,
        false,
        `${jobName} jobs for an earlier run unreadable (HTTP ${fetched?.status || "no response"})`,
      );
    }
    const job = findJob(fetched.jobs, jobName);
    const attempt = finishedAttempt(job, timeoutMs, run);
    if (attempt === null) continue;
    if (attempt === "failed") {
      return jobVerdict(false, false, `${reason}, and before it ${describeEnd(job, jobName, timeoutMs, run)}`);
    }
    const age = ageMs(job.completed_at, now);
    if (age > staleAfterMs) return none;
    return jobVerdict(true, false, `${reason}; an earlier ${jobName} succeeded ${hours(age)} ago`);
  }
  return none;
}

/**
 * Classify already-fetched Nightly Backup runs for one job.
 *
 * `jobsByRunId` maps a run id to `{ status, jobs }` for every run the reader
 * fetched: always the newest, and the earlier ones `candidateOlderRuns` names
 * when `judgeNewest` asks for backing. `now` is injected so the windows are
 * deterministic in tests.
 */
export function evaluateJobFreshness({
  jobName,
  workflowFile,
  staleAfterMs,
  hungAfterMs,
  timeoutMs,
  runsStatus,
  runs,
  jobsByRunId,
  now,
}) {
  if (runsStatus !== 200 || !Array.isArray(runs)) {
    return jobVerdict(
      false,
      false,
      `${workflowFile} runs unreadable (HTTP ${runsStatus || "no response"})`,
    );
  }
  if (runs.length === 0) {
    return jobVerdict(false, false, `no ${workflowFile} runs found`);
  }

  const [run] = runsNewestFirst(runs);
  const judged = judgeNewest({
    jobName,
    run,
    fetched: jobsByRunId.get(run.id),
    staleAfterMs,
    hungAfterMs,
    timeoutMs,
    now,
  });
  if (judged.verdict) return judged.verdict;
  return backedBy({ jobName, runs, jobsByRunId, staleAfterMs, timeoutMs, now, reason: judged.backing });
}

/**
 * GET the recent runs and the newest run's jobs, then, only when the newest
 * run can't decide alone, the earlier runs' jobs until one holds a finished
 * attempt of the job. Never writes. `get(path)` returns `{ status, data }`;
 * the caller owns tokens and the fallback-on-401/403 rule.
 */
export async function readJobFreshness({
  jobName,
  workflowFile,
  staleAfterMs,
  hungAfterMs,
  timeoutMs,
  runsPath,
  jobsPath,
  get,
  now,
}) {
  const evaluate = (fields) =>
    evaluateJobFreshness({ jobName, workflowFile, staleAfterMs, hungAfterMs, timeoutMs, now, ...fields });

  const listed = await get(runsPath);
  const runs = listed.data?.workflow_runs;
  if (listed.status !== 200 || !Array.isArray(runs) || runs.length === 0) {
    return evaluate({
      runsStatus: listed.status,
      runs: Array.isArray(runs) ? runs : null,
      jobsByRunId: new Map(),
    });
  }

  const jobsByRunId = new Map();
  const readJobs = async (run) => {
    const fetched = await get(jobsPath(run.id));
    const entry = { status: fetched.status, jobs: fetched.data?.jobs };
    jobsByRunId.set(run.id, entry);
    return entry;
  };

  const [newest] = runsNewestFirst(runs);
  const judged = judgeNewest({
    jobName,
    run: newest,
    fetched: await readJobs(newest),
    staleAfterMs,
    hungAfterMs,
    timeoutMs,
    now,
  });
  if (judged.backing) {
    for (const run of candidateOlderRuns({ runs, staleAfterMs, now })) {
      const entry = await readJobs(run);
      if (!readable(entry)) break;
      if (finishedAttempt(findJob(entry.jobs, jobName), timeoutMs, run) !== null) break;
    }
  }

  return evaluate({ runsStatus: listed.status, runs, jobsByRunId });
}
