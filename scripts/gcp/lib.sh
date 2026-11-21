# Shared by the scripts in scripts/gcp (#5228); source it, don't run it.
#
# Each environment's region also appears in .github/environments.json
# (cloudRun.region), which the deploy reads. Change both together.

GCP_STAGING_REGION="us-east4"
GCP_PRODUCTION_REGION="us-east5"
CLOUD_RUN_SERVICE="frapp-api"
# The API's public host in each environment: the balancer's certificate and
# the uptime check both use it.
GCP_STAGING_HOST="api-staging.frapp.live"
GCP_PRODUCTION_HOST="api.frapp.live"

step() { printf '\n==> %s\n' "$*"; }

# Every call names the project, so nothing depends on gcloud's own default.
gc() { gcloud --project="$PROJECT_ID" --quiet "$@"; }
exists() { gc "$@" >/dev/null 2>&1; }

# The environment argument decides what a script wires to the project, so a
# project named for the other environment is refused rather than used.
# Usage: require_project_for_environment <staging|production> <project-id> <project-name>
require_project_for_environment() {
  local environment="$1" project_id="$2" project_name="$3" lower
  lower="$(printf '%s %s' "$project_name" "$project_id" | tr '[:upper:]' '[:lower:]')"
  if [[ "$environment" == "staging" && "$lower" != *nonprod* && "$lower" != *staging* ]]; then
    echo "Project $project_id is named \"$project_name\", which doesn't look like the nonprod project. Refusing to use it for staging." >&2
    exit 1
  fi
  if [[ "$environment" == "production" && ( "$lower" == *nonprod* || "$lower" == *staging* || "$lower" != *prod* ) ]]; then
    echo "Project $project_id is named \"$project_name\", which doesn't look like the prod project. Refusing to use it for production." >&2
    exit 1
  fi
}

# Checks $PROJECT_ID belongs to the environment and already runs the API, then
# sets PROJECT_NAME. Usage: require_project_with_service <staging|production> <region> <host>
require_project_with_service() {
  local environment="$1" region="$2" host="$3"
  step "Checking project $PROJECT_ID"
  PROJECT_NAME="$(gcloud projects describe "$PROJECT_ID" --format='value(name)')"
  require_project_for_environment "$environment" "$PROJECT_ID" "$PROJECT_NAME"
  if ! exists run services describe "$CLOUD_RUN_SERVICE" --region="$region"; then
    echo "There is no Cloud Run service $CLOUD_RUN_SERVICE in $region yet. Let a deploy create it first, then run this again." >&2
    exit 1
  fi
  echo "\"$PROJECT_NAME\", service $CLOUD_RUN_SERVICE in $region, host $host"
}
