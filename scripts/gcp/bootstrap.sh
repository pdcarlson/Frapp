#!/usr/bin/env bash
#
# One-time setup of a Google Cloud project for the API on Cloud Run (#5228).
#
# Run it in Cloud Shell, signed in as an owner of the frapp.live organization,
# once per environment, staging first:
#
#   bash scripts/gcp/bootstrap.sh staging <nonprod-project-id>
#   bash scripts/gcp/bootstrap.sh production <prod-project-id> --staging-project <nonprod-project-id>
#
# Add --infisical-org-id <uuid> (Infisical > Organization Settings) to either
# run to set up the identity Infisical's Secret Manager sync acts as.
#
# It is safe to run again: every step looks for what it would create first. A
# first run on a fresh project can stop with "does not exist" while Google
# catches up on a new service account; the script retries that, and running
# it again finishes the job if it still happens. Nothing here holds a secret,
# and it creates no service account keys.
#
# Each environment runs next to its Supabase database, because the API makes
# several database calls per request: staging in us-east4 (Ashburn, beside
# frapp-staging's AWS us-east-1) and production in us-east5 (Columbus, beside
# frapp-prod's us-east-2).
#
# What it sets up in the project:
#   - the Google services the API and its deploys use;
#   - an Artifact Registry repository `frapp` for the API image;
#   - `frapp-api-runtime`, the identity the API runs as, which reads this
#     project's Secret Manager values;
#   - `frapp-deployer`, the identity a GitHub Actions deploy acts as;
#   - a workload identity pool that lets GitHub sign in as `frapp-deployer`
#     with no stored key, only from frapplive/Frapp (matched by its numeric
#     ids, which survive a rename) and only from a job in this environment's
#     GitHub environment (`staging` or `production`);
#   - with --infisical-org-id, `infisical-<org id prefix>`, the identity
#     Infisical Cloud's sync acts as (Infisical requires that name suffix).
#
# Production deploys copy the image staging already ran from the staging
# project's registry into their own, digest unchanged, so --staging-project
# gives production's deployer read access there. That is the only
# cross-project grant, and it only goes from production to staging.
#
# Why each piece exists, and the deploy flow it serves:
# docs/ops/deployment/cloud-run.md.

set -euo pipefail

STAGING_REGION="us-east4"
PRODUCTION_REGION="us-east5"
REPOSITORY="frapp"
RUNTIME_SA_NAME="frapp-api-runtime"
DEPLOYER_SA_NAME="frapp-deployer"
POOL_ID="github"
PROVIDER_ID="frapplive-frapp"
# frapplive/Frapp and its owner, by numeric id: GET https://api.github.com/repos/frapplive/Frapp
GITHUB_REPOSITORY_ID="1157424895"
GITHUB_OWNER_ID="356693519"
# Infisical Cloud (US, app.infisical.com) signs in as this account and acts as
# ours. Infisical ties the account it acts as to one Infisical organization by
# the name suffix; see Infisical's docs/integrations/app-connections/gcp.mdx.
INFISICAL_PRINCIPAL="infisical-us@infisical-us.iam.gserviceaccount.com"

usage() {
  echo "usage: bash scripts/gcp/bootstrap.sh <staging|production> <project-id> [--staging-project <id>] [--infisical-org-id <uuid>]" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
ENVIRONMENT="$1"
PROJECT_ID="$2"
shift 2
STAGING_PROJECT_ID=""
INFISICAL_ORG_ID=""
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 && -n "$2" ]] || usage
  case "$1" in
    --staging-project) STAGING_PROJECT_ID="$2" ;;
    --infisical-org-id) INFISICAL_ORG_ID="$2" ;;
    *) usage ;;
  esac
  shift 2
done

case "$ENVIRONMENT" in
  staging)
    REGION="$STAGING_REGION"
    if [[ -n "$STAGING_PROJECT_ID" ]]; then
      echo "--staging-project is only for production." >&2
      exit 2
    fi
    ;;
  production)
    REGION="$PRODUCTION_REGION"
    if [[ -z "$STAGING_PROJECT_ID" ]]; then
      echo "production needs --staging-project <nonprod-project-id>: its deploys copy the image staging ran." >&2
      exit 2
    fi
    if [[ "$STAGING_PROJECT_ID" == "$PROJECT_ID" ]]; then
      echo "Staging and production must be different projects." >&2
      exit 2
    fi
    ;;
  *) usage ;;
esac

INFISICAL_SA_NAME=""
if [[ -n "$INFISICAL_ORG_ID" ]]; then
  if [[ ! "$INFISICAL_ORG_ID" =~ ^([0-9a-f]{8})-([0-9a-f]{4})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "--infisical-org-id must be the organization's UUID, as Infisical shows it." >&2
    exit 2
  fi
  INFISICAL_SA_NAME="infisical-${BASH_REMATCH[1]}-${BASH_REMATCH[2]}"
fi

step() { printf '\n==> %s\n' "$*"; }
gc() { gcloud --project="$PROJECT_ID" --quiet "$@"; }

# A grant naming a service account or pool made seconds ago can fail while
# Google's IAM catches up. Retry those for about a minute before giving up.
retry() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if "$@"; then return 0; fi
    [[ $attempt -lt 6 ]] || break
    echo "  (retrying in 10 s; a new account or pool can take a minute to appear)" >&2
    sleep 10
  done
  echo "Still failing. Run the script again in a minute; it picks up where it stopped." >&2
  return 1
}

step "Checking project $PROJECT_ID"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
PROJECT_NAME="$(gcloud projects describe "$PROJECT_ID" --format='value(name)')"
# The environment argument decides who may deploy here, so a project named for
# the other environment is refused rather than wired to it.
LOWER_NAME="$(printf '%s %s' "$PROJECT_NAME" "$PROJECT_ID" | tr '[:upper:]' '[:lower:]')"
if [[ "$ENVIRONMENT" == "staging" && "$LOWER_NAME" != *nonprod* && "$LOWER_NAME" != *staging* ]]; then
  echo "Project $PROJECT_ID is named \"$PROJECT_NAME\", which doesn't look like the nonprod project. Refusing to set it up for staging." >&2
  exit 1
fi
if [[ "$ENVIRONMENT" == "production" && ( "$LOWER_NAME" == *nonprod* || "$LOWER_NAME" == *staging* || "$LOWER_NAME" != *prod* ) ]]; then
  echo "Project $PROJECT_ID is named \"$PROJECT_NAME\", which doesn't look like the prod project. Refusing to set it up for production." >&2
  exit 1
fi
BILLING_ENABLED="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)')"
if [[ "$BILLING_ENABLED" != "True" ]]; then
  echo "Billing is not enabled on $PROJECT_ID. Link it to the frapp.live billing account first (Billing > Account management > Projects)." >&2
  exit 1
fi
echo "\"$PROJECT_NAME\", project number $PROJECT_NUMBER, billing enabled, region $REGION"

step "Turning on the Google services the API and its deploys use"
gc services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  logging.googleapis.com \
  aiplatform.googleapis.com

step "Artifact Registry repository $REPOSITORY in $REGION"
if ! gc artifacts repositories describe "$REPOSITORY" --location="$REGION" >/dev/null 2>&1; then
  gc artifacts repositories create "$REPOSITORY" --location="$REGION" \
    --repository-format=docker --description="Frapp API images, one per commit"
fi
# Keep the 50 newest images; delete older ones after 90 days. A Cloud Run
# revision needs its image to start new copies, rollback moves traffic to an
# older revision, and Deploy production copies a commit's image from staging's
# registry, so the keep rule is generous on purpose. A commit whose image was
# cleaned up is deployed by building it again.
CLEANUP_POLICY="$(mktemp)"
cat >"$CLEANUP_POLICY" <<'JSON'
[
  {"name": "keep-newest-50", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 50}},
  {"name": "delete-after-90-days", "action": {"type": "Delete"}, "condition": {"olderThan": "90d"}}
]
JSON
gc artifacts repositories set-cleanup-policies "$REPOSITORY" --location="$REGION" \
  --policy="$CLEANUP_POLICY" >/dev/null
rm -f "$CLEANUP_POLICY"

ensure_sa() {
  local name="$1" display="$2"
  if ! gc iam service-accounts describe "$name@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1; then
    gc iam service-accounts create "$name" --display-name="$display"
  fi
}

project_role() {
  retry gc projects add-iam-policy-binding "$PROJECT_ID" --member="$1" --role="$2" --condition=None >/dev/null
}

RUNTIME_SA="$RUNTIME_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
DEPLOYER_SA="$DEPLOYER_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

step "Service accounts"
ensure_sa "$RUNTIME_SA_NAME" "Frapp API (runs on Cloud Run)"
ensure_sa "$DEPLOYER_SA_NAME" "GitHub Actions deploys"

step "What the API may do: read this project's secrets, and call Vertex AI in it"
project_role "serviceAccount:$RUNTIME_SA" roles/secretmanager.secretAccessor
# Vertex AI bills to this project and the API signs in as this account, so no
# key file is needed on Cloud Run (GOOGLE_VERTEX_CREDENTIALS_JSON, ai-config.ts).
project_role "serviceAccount:$RUNTIME_SA" roles/aiplatform.user

step "What a deploy may do: manage Cloud Run, push images, list secrets, run the API as its identity"
# run.admin for now: a deploy also turns off Cloud Run's invoker check so the
# API is public (an allUsers grant is likely refused by the organization's
# default policy), and that is a setting about who may call the service. Try
# run.developer once the deploy path is proven.
project_role "serviceAccount:$DEPLOYER_SA" roles/run.admin
project_role "serviceAccount:$DEPLOYER_SA" roles/secretmanager.viewer
retry gc artifacts repositories add-iam-policy-binding "$REPOSITORY" --location="$REGION" \
  --member="serviceAccount:$DEPLOYER_SA" --role=roles/artifactregistry.writer >/dev/null
retry gc iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$DEPLOYER_SA" --role=roles/iam.serviceAccountUser >/dev/null

step "GitHub keyless sign-in (workload identity pool $POOL_ID)"
POOL_STATE="$(gc iam workload-identity-pools describe "$POOL_ID" --location=global --format='value(state)' 2>/dev/null || true)"
if [[ -z "$POOL_STATE" ]]; then
  gc iam workload-identity-pools create "$POOL_ID" --location=global \
    --display-name="GitHub Actions"
elif [[ "$POOL_STATE" == "DELETED" ]]; then
  gc iam workload-identity-pools undelete "$POOL_ID" --location=global
fi
PROVIDER_CONDITION="assertion.repository_id == '$GITHUB_REPOSITORY_ID' && assertion.repository_owner_id == '$GITHUB_OWNER_ID' && assertion.environment == '$ENVIRONMENT'"
PROVIDER_MAPPING="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment"
PROVIDER_STATE="$(gc iam workload-identity-pools providers describe "$PROVIDER_ID" --location=global \
  --workload-identity-pool="$POOL_ID" --format='value(state)' 2>/dev/null || true)"
if [[ -z "$PROVIDER_STATE" ]]; then
  retry gc iam workload-identity-pools providers create-oidc "$PROVIDER_ID" --location=global \
    --workload-identity-pool="$POOL_ID" --display-name="frapplive/Frapp" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$PROVIDER_MAPPING" --attribute-condition="$PROVIDER_CONDITION"
else
  if [[ "$PROVIDER_STATE" == "DELETED" ]]; then
    gc iam workload-identity-pools providers undelete "$PROVIDER_ID" --location=global \
      --workload-identity-pool="$POOL_ID"
  fi
  gc iam workload-identity-pools providers update-oidc "$PROVIDER_ID" --location=global \
    --workload-identity-pool="$POOL_ID" \
    --attribute-mapping="$PROVIDER_MAPPING" --attribute-condition="$PROVIDER_CONDITION"
fi
POOL_PRINCIPAL="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.environment/$ENVIRONMENT"
retry gc iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --member="$POOL_PRINCIPAL" --role=roles/iam.workloadIdentityUser >/dev/null

if [[ "$ENVIRONMENT" == "production" ]]; then
  step "Production's deployer may read staging's images ($STAGING_PROJECT_ID)"
  retry gcloud --project="$STAGING_PROJECT_ID" --quiet artifacts repositories add-iam-policy-binding "$REPOSITORY" \
    --location="$STAGING_REGION" --member="serviceAccount:$DEPLOYER_SA" --role=roles/artifactregistry.reader >/dev/null
fi

INFISICAL_SA=""
if [[ -n "$INFISICAL_SA_NAME" ]]; then
  INFISICAL_SA="$INFISICAL_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
  step "Infisical's sync identity ($INFISICAL_SA_NAME)"
  ensure_sa "$INFISICAL_SA_NAME" "Infisical Secret Manager sync"
  # Secret Manager Admin, as Infisical's Secret Sync setup asks: the sync
  # creates, updates and deletes secrets, and imports existing ones. It can
  # therefore also read this project's values.
  project_role "serviceAccount:$INFISICAL_SA" roles/secretmanager.admin
  # Infisical lists a project for a sync only after checking that Secret
  # Manager is on there, which reads the project's services. Without this the
  # sync's project list is empty (2026-11-16).
  project_role "serviceAccount:$INFISICAL_SA" roles/serviceusage.serviceUsageViewer
  if ! gc iam service-accounts add-iam-policy-binding "$INFISICAL_SA" \
    --member="serviceAccount:$INFISICAL_PRINCIPAL" --role=roles/iam.serviceAccountTokenCreator >/dev/null; then
    echo "Google refused to let Infisical act as $INFISICAL_SA_NAME." >&2
    echo "If the error says the principal doesn't belong to a permitted customer, the organization's" >&2
    echo "Domain restricted sharing policy needs Infisical's customer ID (C03rsjmyl) added first;" >&2
    echo "see docs/ops/deployment/cloud-run.md, then run this script again." >&2
    exit 1
  fi
fi

step "Done. Paste this block back into the chat (none of it is secret):"
cat <<EOF
environment:        $ENVIRONMENT
gcpProjectId:       $PROJECT_ID
gcpProjectNumber:   $PROJECT_NUMBER
region:             $REGION
registry:           $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY
runtimeAccount:     $RUNTIME_SA
deployerAccount:    $DEPLOYER_SA
infisicalAccount:   ${INFISICAL_SA:-not set up (pass --infisical-org-id)}
identityProvider:   projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/providers/$PROVIDER_ID
EOF
