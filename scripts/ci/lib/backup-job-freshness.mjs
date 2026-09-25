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
// THE RULES
// - Unreadable Actions responses are FAIL, never pass.
// - The newest run decides alone when its job succeeded (fresh within the
//   stale window, the one verdict that may close an open alert; FAIL when
//   older), when it is hung past the hung window, and when the job is missing
//   from a run that ran (a renamed or deleted job must not green).
// - Otherwise the newest run's job is in flight (queued, running, or
//   `waiting` on a deployment protection rule), or it was cancelled, failed
//   or skipped, or the run was cancelled or skipped before any job was
//   created. Then it passes only while an earlier run holds a success of the
//   job that completed within the stale window, and that pass is never fresh,
//   so it never closes an open alert.
//
// Why the fallback to an earlier success (#2332): judging the newest run
// alone let an in-flight run return before the stale check, so a job parked
// in `waiting` greened the watch every night while nothing was backed up,
// since each night's new run reset the age the hung check measures. In the
// other direction, one cancelled dispatch raised a P1 against a job that had
// succeeded hours earlier, which teaches responders to distrust the alert.
//
// The price, accepted in #2332: a genuinely failed night passes while the
// previous night's success is within the window, so a single failure alerts
// about a day late, on the next night's watch if that night fails too. The
// scripts print every pass that isn't fresh as a `::warning::`, so the run
// says so even though it is green.
//
// The earlier runs searched are the ones the caller lists (the scripts ask
// for the 30 newest on `main`). More than that many runs inside the window
// could hide an earlier success; that fails closed, as a P1.

const IN_FLIGHT_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "pending",
  "requested",
]);

// Run conclusions that leave no job rows when they happen before a job is
// created: a dispatch cancelled while pending on the concurrency group.
const NO_JOB_CONCLUSIONS = new Set(["cancelled", "skipped"]);

/** `ok` greens the run. `fresh` is the only verdict that may close the alert. */
export function jobVerdict(ok, fresh, reason) {
  return { ok, fresh: Boolean(ok && fresh), reason };
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

/**
 * The job's success in one run's jobs, if it completed within the window.
 * The one success test the reader and the evaluator both use, so they stop
 * at the same run.
 */
export function successWithin({ jobs, jobName, staleAfterMs, now }) {
  const job = findJob(jobs, jobName);
  if (!job || job.status !== "completed" || job.conclusion !== "success") return null;
  return ageMs(job.completed_at, now) <= staleAfterMs ? job : null;
}

/**
 * Judge the newest run on its own. Returns `{ verdict }` when it decides, or
 * `{ backing }` (the reason to report) when the verdict rests on an earlier
 * success. The reader uses this to decide whether to read earlier runs.
 */
export function judgeNewest({ jobName, run, fetched, staleAfterMs, hungAfterMs, now }) {
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
    if (NO_JOB_CONCLUSIONS.has(run.conclusion) && fetched.jobs.length === 0) {
      return { backing: `the newest run was ${run.conclusion} before ${jobName} started` };
    }
    return { verdict: jobVerdict(false, false, `${jobName} job is missing`) };
  }

  if (IN_FLIGHT_STATUSES.has(job.status)) {
    if (ageMs(job.started_at || run.created_at, now) > hungAfterMs) return hung;
    return { backing: `${jobName} is in flight` };
  }

  if (job.conclusion !== "success") {
    return { backing: `${jobName} concluded ${job.conclusion || "unknown"}` };
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
 * A pass resting on an earlier success, or FAIL. Never fresh: only the newest
 * run's own success may close an alert. A run the walk reaches with no entry
 * in `jobsByRunId`, or an unreadable one, is FAIL, because the success it
 * might hold can't be ruled in or out.
 */
function backedBy({ jobName, runs, jobsByRunId, staleAfterMs, now, reason }) {
  for (const run of candidateOlderRuns({ runs, staleAfterMs, now })) {
    const fetched = jobsByRunId.get(run.id);
    if (!readable(fetched)) {
      return jobVerdict(
        false,
        false,
        `${jobName} jobs for an earlier run unreadable (HTTP ${fetched?.status || "no response"})`,
      );
    }
    const success = successWithin({ jobs: fetched.jobs, jobName, staleAfterMs, now });
    if (success) {
      return jobVerdict(
        true,
        false,
        `${reason}; an earlier ${jobName} succeeded ${hours(ageMs(success.completed_at, now))} ago`,
      );
    }
  }
  return jobVerdict(false, false, `${reason}, and no ${jobName} success is within ${hours(staleAfterMs)}`);
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
    now,
  });
  if (judged.verdict) return judged.verdict;
  return backedBy({ jobName, runs, jobsByRunId, staleAfterMs, now, reason: judged.backing });
}

/**
 * GET the recent runs and the newest run's jobs, then, only when the newest
 * run can't decide alone, the earlier runs' jobs until one holds a success
 * within the window. Never writes. `get(path)` returns `{ status, data }`;
 * the caller owns tokens and the fallback-on-401/403 rule.
 */
export async function readJobFreshness({
  jobName,
  workflowFile,
  staleAfterMs,
  hungAfterMs,
  runsPath,
  jobsPath,
  get,
  now,
}) {
  const evaluate = (fields) =>
    evaluateJobFreshness({ jobName, workflowFile, staleAfterMs, hungAfterMs, now, ...fields });

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
    now,
  });
  if (judged.backing) {
    for (const run of candidateOlderRuns({ runs, staleAfterMs, now })) {
      const entry = await readJobs(run);
      if (!readable(entry)) break;
      if (successWithin({ jobs: entry.jobs, jobName, staleAfterMs, now })) break;
    }
  }

  return evaluate({ runsStatus: listed.status, runs, jobsByRunId });
}
