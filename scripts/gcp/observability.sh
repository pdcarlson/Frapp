#!/usr/bin/env bash
#
# Google Cloud's watch on the API (#5228): an uptime check, email alerts, and a
# record of every secret read. Sentry and PostHog stay as they are; this covers
# what they can't see, such as a container that keeps crashing, memory running
# out, or the API host not answering at all.
#
# Run it in Cloud Shell, signed in as an owner of the frapp.live organization,
# after scripts/gcp/load-balancer.sh, once per project:
#
#   bash scripts/gcp/observability.sh staging <nonprod-project-id> <alert-email>
#   bash scripts/gcp/observability.sh production <prod-project-id> <alert-email>
#
# The email is an argument, not a constant here, because the repository is
# public. It is safe to run again: what exists is updated to match, never
# duplicated, so a rerun is also how a threshold change in this file reaches a
# project.
#
# What it makes:
#   - one email notification channel, "Frapp alerts", which every policy uses;
#   - an uptime check on https://<API host>/health/ready every minute, from
#     Google's checker regions, with the certificate validated;
#   - five alert policies: the uptime check failing, a burst of 5xx responses,
#     the container crashing or failing its startup probe, memory near the
#     limit, and a burst of error logs (a log-based metric counts them);
#   - Secret Manager's data-access audit log (DATA_READ and ADMIN_READ), so
#     every secret read, by the deploy or the running service, is recorded.
#
# Email is the pager (docs/ops/alert-routing.md): there is no paid paging.

set -euo pipefail

# shellcheck source=scripts/gcp/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STAGING_HOST="api-staging.frapp.live"
PRODUCTION_HOST="api.frapp.live"
SERVICE="$CLOUD_RUN_SERVICE"

CHANNEL_NAME="Frapp alerts"
ERROR_METRIC="frapp_api_error_logs"
# The service's memory limit is 1 GiB (scripts/ci/deploy-cloud-run.mjs).
MEMORY_THRESHOLD="0.85"
# Per five minutes. The API answers a few thousand requests a day, so ten 5xx or
# twenty error lines in five minutes is an incident, not noise.
FIVE_XX_THRESHOLD=10
ERROR_LOG_THRESHOLD=20
RUNBOOK="https://github.com/frapplive/Frapp/blob/main/docs/ops/deployment/cloud-run.md#observability"

usage() {
  echo "usage: bash scripts/gcp/observability.sh <staging|production> <project-id> <alert-email>" >&2
  exit 2
}

[[ $# -eq 3 ]] || usage
ENVIRONMENT="$1"
PROJECT_ID="$2"
ALERT_EMAIL="$3"
case "$ENVIRONMENT" in
  staging) REGION="$GCP_STAGING_REGION"; HOST="$STAGING_HOST"; LABEL="staging" ;;
  production) REGION="$GCP_PRODUCTION_REGION"; HOST="$PRODUCTION_HOST"; LABEL="production" ;;
  *) usage ;;
esac
if [[ ! "$ALERT_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
  echo "\"$ALERT_EMAIL\" doesn't look like an email address." >&2
  exit 2
fi

exists() { gc "$@" >/dev/null 2>&1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

step "Checking project $PROJECT_ID"
PROJECT_NAME="$(gcloud projects describe "$PROJECT_ID" --format='value(name)')"
require_project_for_environment "$ENVIRONMENT" "$PROJECT_ID" "$PROJECT_NAME"
if ! exists run services describe "$SERVICE" --region="$REGION"; then
  echo "There is no Cloud Run service $SERVICE in $REGION yet. Let a deploy create it first, then run this again." >&2
  exit 1
fi
echo "\"$PROJECT_NAME\", service $SERVICE in $REGION, host $HOST"

step "Turning on Cloud Monitoring"
gc services enable monitoring.googleapis.com logging.googleapis.com

step "Email channel \"$CHANNEL_NAME\""
CHANNEL="$(gc beta monitoring channels list --filter="displayName=\"$CHANNEL_NAME\"" --format='value(name)' | head -n 1)"
if [[ -z "$CHANNEL" ]]; then
  CHANNEL="$(gc beta monitoring channels create --display-name="$CHANNEL_NAME" --type=email \
    --description="Every Frapp API alert in this project (scripts/gcp/observability.sh)" \
    --channel-labels="email_address=$ALERT_EMAIL" --format='value(name)')"
else
  gc beta monitoring channels update "$CHANNEL" --update-channel-labels="email_address=$ALERT_EMAIL" >/dev/null
fi
echo "$CHANNEL"

step "Uptime check on https://$HOST/health/ready"
UPTIME_NAME="Frapp API ($LABEL) /health/ready"
UPTIME="$(gc monitoring uptime list-configs --filter="displayName=\"$UPTIME_NAME\"" --format='value(name)' | head -n 1)"
if [[ -z "$UPTIME" ]]; then
  UPTIME="$(gc monitoring uptime create "$UPTIME_NAME" --resource-type=uptime-url \
    --resource-labels="host=$HOST,project_id=$PROJECT_ID" --protocol=https --port=443 --path=/health/ready \
    --validate-ssl=true --status-classes=2xx --period=1 --timeout=10 --format='value(name)')"
fi
CHECK_ID="${UPTIME##*/}"
echo "$UPTIME"

step "Log-based metric $ERROR_METRIC (the API's lines at ERROR or above)"
# The API's own output only: Cloud Run's request log marks every 5xx ERROR
# too, and the 5xx policy already counts those.
LOGS="projects/$PROJECT_ID/logs/run.googleapis.com"
ERROR_FILTER="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND severity>=ERROR AND (logName=\"$LOGS%2Fstdout\" OR logName=\"$LOGS%2Fstderr\")"
if exists logging metrics describe "$ERROR_METRIC"; then
  gc logging metrics update "$ERROR_METRIC" --log-filter="$ERROR_FILTER" >/dev/null
else
  gc logging metrics create "$ERROR_METRIC" --description="Frapp API log lines at ERROR or above" --log-filter="$ERROR_FILTER"
fi

# Creates the policy in $WORK/<file>.json, or updates the policy of the same
# display name. A metric a log-based metric has only just defined can take a
# minute to be accepted, so a refused create is retried.
apply_policy() {
  local file="$1" display existing tries=0
  display="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["displayName"])' "$WORK/$file")"
  existing="$(gc monitoring policies list --filter="displayName=\"$display\"" --format='value(name)' | head -n 1)"
  if [[ -n "$existing" ]]; then
    gc monitoring policies update "$existing" --policy-from-file="$WORK/$file" >/dev/null
    echo "updated: $display"
    return
  fi
  until gc monitoring policies create --policy-from-file="$WORK/$file" >/dev/null; do
    tries=$((tries + 1))
    if [[ $tries -ge 5 ]]; then
      echo "Couldn't create \"$display\" after 5 tries. Run this script again in a few minutes." >&2
      exit 1
    fi
    echo "Google refused \"$display\"; retrying in 30 seconds."
    sleep 30
  done
  echo "created: $display"
}

step "Alert policies"
# Written by Python so the filters need no shell quoting. Every policy emails
# the channel, says what to look at, and closes itself a day after its
# condition clears.
LABEL="$LABEL" HOST="$HOST" SERVICE="$SERVICE" REGION="$REGION" PROJECT_ID="$PROJECT_ID" \
  CHANNEL="$CHANNEL" CHECK_ID="$CHECK_ID" ERROR_METRIC="$ERROR_METRIC" RUNBOOK="$RUNBOOK" \
  MEMORY_THRESHOLD="$MEMORY_THRESHOLD" FIVE_XX_THRESHOLD="$FIVE_XX_THRESHOLD" \
  ERROR_LOG_THRESHOLD="$ERROR_LOG_THRESHOLD" python3 - "$WORK" <<'PY'
import json, os, sys

e = os.environ
work = sys.argv[1]
label, service, project = e["LABEL"], e["SERVICE"], e["PROJECT_ID"]
revision = f'resource.type="cloud_run_revision" AND resource.label.service_name="{service}"'
memory_pct = round(float(e["MEMORY_THRESHOLD"]) * 100)


def threshold(display, flt, aligner, reducer, value, duration, period="300s", group_by=None):
    agg = {"alignmentPeriod": period, "perSeriesAligner": aligner, "crossSeriesReducer": reducer}
    if group_by:
        agg["groupByFields"] = group_by
    return {
        "displayName": display,
        "conditionThreshold": {
            "filter": flt,
            "aggregations": [agg],
            "comparison": "COMPARISON_GT",
            "thresholdValue": value,
            "duration": duration,
            "trigger": {"count": 1},
        },
    }


def policy(file, display, doc, condition, strategy=None):
    body = {
        "displayName": f"Frapp API ({label}): {display}",
        "combiner": "OR",
        "enabled": True,
        "notificationChannels": [e["CHANNEL"]],
        "documentation": {
            "mimeType": "text/markdown",
            "content": f"{doc}\n\nProject {project}, service {service} in {e['REGION']}. "
            f"Logs: Logging, Logs Explorer, resource Cloud Run Revision. Runbook: {e['RUNBOOK']}",
        },
        "alertStrategy": {"autoClose": "86400s", **(strategy or {})},
        "conditions": [condition],
    }
    with open(os.path.join(work, file), "w") as f:
        json.dump(body, f, indent=2)


policy(
    "uptime.json",
    "not answering",
    f"https://{e['HOST']}/health/ready has failed from more than one of Google's checker regions. "
    "The API is down, or not ready because something it needs (the database) isn't answering.",
    threshold(
        "/health/ready failing",
        'metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND resource.type="uptime_url" '
        f'AND metric.label.check_id="{e["CHECK_ID"]}"',
        "ALIGN_NEXT_OLDER", "REDUCE_COUNT_FALSE", 1, "60s", period="1200s", group_by=["resource.label.*"],
    ),
)

five_xx = int(e["FIVE_XX_THRESHOLD"])
policy(
    "five-xx.json",
    "5xx burst",
    f"More than {five_xx} responses with a 5xx status in five minutes.",
    threshold(
        f"More than {five_xx} 5xx in 5 minutes",
        f'metric.type="run.googleapis.com/request_count" AND {revision} AND metric.label.response_code_class="5xx"',
        "ALIGN_SUM", "REDUCE_SUM", five_xx, "0s",
    ),
)

# Cloud Run's own system log says when a container exits with an error, is
# killed for memory, or fails a probe. Exit code 0 (a scale-down) is left out.
system_log = f"projects/{project}/logs/run.googleapis.com%2Fvarlog%2Fsystem"
policy(
    "crash.json",
    "container crashed",
    "A container exited with an error, ran out of memory, or failed a health probe. "
    "Cloud Run starts a new one, so more than one of these means a crash loop.",
    {
        "displayName": "Crash, memory kill or failed probe in the system log",
        "conditionMatchedLog": {
            "filter": f'{revision.replace("resource.label.", "resource.labels.")} AND logName="{system_log}" '
            'AND (textPayload=~"Container called exit[(][1-9]" OR textPayload:"Memory limit" OR textPayload:"probe failed")'
        },
    },
    strategy={"notificationRateLimit": {"period": "300s"}},
)

threshold_value = float(e["MEMORY_THRESHOLD"])
policy(
    "memory.json",
    "memory near the limit",
    f"A container has used more than {memory_pct}% of its memory limit for five minutes. Past 100% Cloud Run kills it.",
    threshold(
        f"Memory above {memory_pct}% for 5 minutes",
        f'metric.type="run.googleapis.com/container/memory/utilizations" AND {revision}',
        "ALIGN_PERCENTILE_99", "REDUCE_MAX", threshold_value, "300s", period="60s",
        group_by=["resource.label.revision_name"],
    ),
)

errors = int(e["ERROR_LOG_THRESHOLD"])
policy(
    "errors.json",
    "error log burst",
    f"More than {errors} log lines at ERROR or above in five minutes. Sentry has the stack traces.",
    threshold(
        f"More than {errors} error lines in 5 minutes",
        f'metric.type="logging.googleapis.com/user/{e["ERROR_METRIC"]}" AND resource.type="cloud_run_revision"',
        "ALIGN_SUM", "REDUCE_SUM", errors, "0s",
    ),
)
PY
for file in uptime.json five-xx.json crash.json memory.json errors.json; do
  apply_policy "$file"
done

# The project's IAM policy carries the audit config. Only the auditConfigs
# entry for Secret Manager is added; the bindings and the etag go back exactly
# as read, so a policy changed in between is refused rather than overwritten.
step "Secret Manager data-access audit log"
gc projects get-iam-policy "$PROJECT_ID" --format=json > "$WORK/iam.json"
if python3 - "$WORK/iam.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    policy = json.load(f)
configs = policy.setdefault("auditConfigs", [])
entry = next((c for c in configs if c.get("service") == "secretmanager.googleapis.com"), None)
if entry is None:
    entry = {"service": "secretmanager.googleapis.com", "auditLogConfigs": []}
    configs.append(entry)
have = {c.get("logType") for c in entry.setdefault("auditLogConfigs", [])}
missing = [t for t in ("ADMIN_READ", "DATA_READ") if t not in have]
if not missing:
    sys.exit(1)
entry["auditLogConfigs"].extend({"logType": t} for t in missing)
with open(path, "w") as f:
    json.dump(policy, f)
PY
then
  gc projects set-iam-policy "$PROJECT_ID" "$WORK/iam.json" >/dev/null
  echo "Turned on: every secret read is now in cloudaudit.googleapis.com/data_access."
else
  echo "Already on."
fi

cat <<DONE

==> Done ($ENVIRONMENT)

Alerts go to $ALERT_EMAIL. Google sends nothing to that address until an alert
fires. To see them: Monitoring, Alerting (policies) and Monitoring, Uptime
checks ("$UPTIME_NAME"; its first results take a few minutes).
DONE
