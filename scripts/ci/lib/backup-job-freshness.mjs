// The verdict both production backup-freshness watches share: is one job of
// Nightly Backup (`db-backup.yml`) recent, successful, and not hung?
//
// `production-backup-freshness.mjs` (the Postgres dump) and
// `production-backup-storage-freshness.mjs` (the Storage mirror) watch two
// jobs of the same workflow with the same rules, so the rules live here once
// and each script passes its own job name and windows. The constants stay in
// the scripts, where their source-text locks pin them.
//
// THE RULES
// - Unreadable Actions responses are FAIL, never pass.
// - The newest run decides only when its job succeeded: within the stale
//   window it is fresh (the one verdict that may close an open alert), and
//   older is FAIL.
// - A newest run that is still in flight (queued, running, or `waiting` on a
//   deployment protection rule) passes only while it is under the hung window
//   AND the job's most recent success is within the stale window.
// - A newest run whose job was cancelled, failed or skipped passes only when
//   the job's most recent success is within the stale window.
// - Neither of those two passes is fresh, so neither closes an open alert.
//
// Why the fallback to the last success (#2332): judging the newest run alone
// let an in-flight run return before the stale check, so a job parked in
// `waiting` greened the watch every night while nothing was backed up, since
// each night's new run reset the age the hung check measures. In the other
// direction, one cancelled dispatch raised a P1 against a job that had
// succeeded hours earlier, which teaches responders to distrust the alert.

const IN_FLIGHT_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "pending",
  "requested",
]);

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

/**
 * The older runs worth reading for the job's last success: newest first, not
 * in flight, and young enough that a success in them could still be inside
 * the stale window (a job completes at most the hung window after its run is
 * created, or it would have been reported hung).
 */
export function candidateOlderRuns({ runs, staleAfterMs, hungAfterMs, now }) {
  return runsNewestFirst(runs)
    .slice(1)
    .filter((run) => !IN_FLIGHT_STATUSES.has(run.status))
    .filter((run) => ageMs(run.created_at, now) <= staleAfterMs + hungAfterMs);
}

/**
 * Walk the older runs for the job's most recent success.
 *
 * `jobsByRunId` holds `{ status, jobs }` per run id, as the reader fetched
 * them. A run the walk reaches with no entry, or with an unreadable one, is
 * unreadable: it is FAIL, because the success it might hold can't be ruled
 * out or in.
 *
 * @returns {{ unreadable: string } | { success: object | null }}
 */
function lastSuccess({ jobName, runs, jobsByRunId, staleAfterMs, hungAfterMs, now }) {
  for (const run of candidateOlderRuns({ runs, staleAfterMs, hungAfterMs, now })) {
    const fetched = jobsByRunId.get(run.id);
    if (!fetched || fetched.status !== 200 || !Array.isArray(fetched.jobs)) {
      return {
        unreadable: `${jobName} jobs for an earlier run unreadable (HTTP ${fetched?.status || "no response"})`,
      };
    }
    const job = fetched.jobs.find((entry) => entry && entry.name === jobName);
    if (job && job.status === "completed" && job.conclusion === "success") {
      return { success: job };
    }
  }
  return { success: null };
}

/**
 * A pass that rests on an earlier success, or the FAIL `failReason` names.
 * Never fresh: only the newest run's own success may close an alert.
 */
function backedBy({ jobName, runs, jobsByRunId, staleAfterMs, hungAfterMs, now, passReason, failReason }) {
  const found = lastSuccess({ jobName, runs, jobsByRunId, staleAfterMs, hungAfterMs, now });
  if ("unreadable" in found) return jobVerdict(false, false, found.unreadable);
  if (!found.success) {
    return jobVerdict(false, false, `${failReason}, and no ${jobName} success is within ${hours(staleAfterMs)}`);
  }
  const age = ageMs(found.success.completed_at, now);
  if (age > staleAfterMs) {
    return jobVerdict(false, false, `${failReason}, and the last ${jobName} success is older than ${hours(staleAfterMs)}`);
  }
  return jobVerdict(true, false, `${passReason}; the last ${jobName} success was ${hours(age)} ago`);
}

/**
 * Classify already-fetched Nightly Backup runs for one job.
 *
 * `jobsByRunId` maps a run id to `{ status, jobs }` for every run the reader
 * fetched: always the newest, and the older ones `candidateOlderRuns` names
 * when the newest run didn't succeed. `now` is injected so the windows are
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
  const newest = jobsByRunId.get(run.id);
  if (!newest || newest.status !== 200 || !Array.isArray(newest.jobs)) {
    return jobVerdict(
      false,
      false,
      `${jobName} jobs unreadable (HTTP ${newest?.status || "no response"})`,
    );
  }

  const context = { jobName, runs, jobsByRunId, staleAfterMs, hungAfterMs, now };
  const job = newest.jobs.find((entry) => entry && entry.name === jobName);
  if (!job) {
    if (IN_FLIGHT_STATUSES.has(run.status)) {
      if (ageMs(run.run_started_at || run.created_at, now) > hungAfterMs) {
        return jobVerdict(false, false, `${jobName} hung for more than ${hours(hungAfterMs)}`);
      }
      return backedBy({
        ...context,
        passReason: `${jobName} is in flight`,
        failReason: `${jobName} is in flight`,
      });
    }
    return jobVerdict(false, false, `${jobName} job is missing`);
  }

  if (IN_FLIGHT_STATUSES.has(job.status)) {
    if (ageMs(job.started_at || run.created_at, now) > hungAfterMs) {
      return jobVerdict(false, false, `${jobName} hung for more than ${hours(hungAfterMs)}`);
    }
    return backedBy({
      ...context,
      passReason: `${jobName} is in flight`,
      failReason: `${jobName} is in flight`,
    });
  }

  if (job.conclusion !== "success") {
    const concluded = `${jobName} concluded ${job.conclusion || "unknown"}`;
    return backedBy({ ...context, passReason: concluded, failReason: concluded });
  }

  if (ageMs(job.completed_at, now) > staleAfterMs) {
    return jobVerdict(false, false, `last ${jobName} success is older than ${hours(staleAfterMs)}`);
  }

  return jobVerdict(true, true, `${jobName} succeeded within ${hours(staleAfterMs)}`);
}

/** Whether the newest run's job succeeded, so no older run needs reading. */
function newestSucceeded({ jobName, fetched }) {
  if (fetched.status !== 200 || !Array.isArray(fetched.jobs)) return false;
  const job = fetched.jobs.find((entry) => entry && entry.name === jobName);
  return Boolean(job && job.status === "completed" && job.conclusion === "success");
}

/**
 * GET the recent runs, the newest run's jobs, and, only when the newest run's
 * job didn't succeed, the older runs' jobs until one holds a success. Never
 * writes. `get(path)` returns `{ status, data }`; the caller owns tokens and
 * the fallback-on-401/403 rule.
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
  const newestJobs = await readJobs(newest);
  if (!newestSucceeded({ jobName, fetched: newestJobs }) && newestJobs.status === 200) {
    for (const run of candidateOlderRuns({ runs, staleAfterMs, hungAfterMs, now })) {
      const entry = await readJobs(run);
      if (entry.status !== 200 || newestSucceeded({ jobName, fetched: entry })) break;
    }
  }

  return evaluate({ runsStatus: listed.status, runs, jobsByRunId });
}
