# Shared by the scripts in scripts/gcp (#5228); source it, don't run it.
#
# Each environment's region also appears in .github/environments.json
# (cloudRun.region), which the deploy reads. Change both together.

GCP_STAGING_REGION="us-east4"
GCP_PRODUCTION_REGION="us-east5"
CLOUD_RUN_SERVICE="frapp-api"

step() { printf '\n==> %s\n' "$*"; }

# Every call names the project, so nothing depends on gcloud's own default.
gc() { gcloud --project="$PROJECT_ID" --quiet "$@"; }

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
