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
# It is safe to run again: every step looks for what it would create first.
# Nothing here holds a secret, and it creates no service account keys.
#
# What it sets up in the project, all in Columbus (us-east5, next to
# Supabase's us-east-2):
#   - the Google services the API and its deploys use;
#   - an Artifact Registry repository `frapp` for the API image;
#   - `frapp-api-runtime`, the identity the API runs as: it reads this
#     project's Secret Manager values and calls Vertex AI, so the API needs
#     no key file for either;
#   - `frapp-deployer`, the identity a GitHub Actions deploy acts as;
#   - a workload identity pool that lets GitHub sign in as `frapp-deployer`
#     with no stored key, and only from frapplive/Frapp (matched by its
#     numeric ids, which survive a rename) running in this environment's
#     GitHub environment (`staging` or `production`);
#   - `infisical-sync`, the identity Infisical's Secret Manager sync acts as.
#
# Production deploys copy the image staging already ran from the staging
# project's registry into its own, digest unchanged, so --staging-project gives
# production's deployer read access there. That is the only cross-project
# grant, and it only goes from production to staging.
#
# Why each piece exists, and the deploy flow it serves:
# docs/ops/deployment/cloud-run.md.

set -euo pipefail

REGION="us-east5"
REPOSITORY="frapp"
RUNTIME_SA_NAME="frapp-api-runtime"
DEPLOYER_SA_NAME="frapp-deployer"
INFISICAL_SA_NAME="infisical-sync"
POOL_ID="github"
PROVIDER_ID="frapplive-frapp"
# frapplive/Frapp and its owner, by numeric id: GET https://api.github.com/repos/frapplive/Frapp
GITHUB_REPOSITORY_ID="1157424895"
GITHUB_OWNER_ID="356693519"

usage() {
  echo "usage: bash scripts/gcp/bootstrap.sh <staging|production> <project-id> [--staging-project <id>] [--infisical-principal <service-account-email>]" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
ENVIRONMENT="$1"
PROJECT_ID="$2"
shift 2
STAGING_PROJECT_ID=""
INFISICAL_PRINCIPAL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --staging-project) STAGING_PROJECT_ID="${2:-}"; shift 2 ;;
    --infisical-principal) INFISICAL_PRINCIPAL="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

case "$ENVIRONMENT" in
  staging) ;;
  production)
    if [[ -z "$STAGING_PROJECT_ID" ]]; then
      echo "production needs --staging-project <nonprod-project-id>: its deploys copy the image staging ran." >&2
      exit 2
    fi
    ;;
  *) usage ;;
esac

step() { printf '\n==> %s\n' "$*"; }
gc() { gcloud --project="$PROJECT_ID" --quiet "$@"; }

step "Checking project $PROJECT_ID"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
BILLING_ENABLED="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)')"
if [[ "$BILLING_ENABLED" != "True" ]]; then
  echo "Billing is not enabled on $PROJECT_ID. Link it to the frapp.live billing account first (Billing > Account management > Projects)." >&2
  exit 1
fi
echo "project number $PROJECT_NUMBER, billing enabled"

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
  aiplatform.googleapis.com \
  logging.googleapis.com

step "Artifact Registry repository $REPOSITORY in $REGION"
if ! gc artifacts repositories describe "$REPOSITORY" --location="$REGION" >/dev/null 2>&1; then
  gc artifacts repositories create "$REPOSITORY" --location="$REGION" \
    --repository-format=docker --description="Frapp API images, one per commit"
fi
# Keep the 30 newest images; delete older ones after 60 days. A Cloud Run
# revision needs its image to start new copies, and rollback moves traffic to
# an older revision, so the keep rule is generous on purpose.
CLEANUP_POLICY="$(mktemp)"
cat >"$CLEANUP_POLICY" <<'JSON'
[
  {"name": "keep-newest-30", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 30}},
  {"name": "delete-after-60-days", "action": {"type": "Delete"}, "condition": {"olderThan": "60d"}}
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
  gc projects add-iam-policy-binding "$PROJECT_ID" --member="$1" --role="$2" --condition=None >/dev/null
}

RUNTIME_SA="$RUNTIME_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
DEPLOYER_SA="$DEPLOYER_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
INFISICAL_SA="$INFISICAL_SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

step "Service accounts"
ensure_sa "$RUNTIME_SA_NAME" "Frapp API (runs on Cloud Run)"
ensure_sa "$DEPLOYER_SA_NAME" "GitHub Actions deploys"
ensure_sa "$INFISICAL_SA_NAME" "Infisical Secret Manager sync"

step "What the API may do: read this project's secrets, call Vertex AI"
project_role "serviceAccount:$RUNTIME_SA" roles/secretmanager.secretAccessor
project_role "serviceAccount:$RUNTIME_SA" roles/aiplatform.user

step "What a deploy may do: manage Cloud Run, push images, list secrets, run the API as its identity"
project_role "serviceAccount:$DEPLOYER_SA" roles/run.admin
project_role "serviceAccount:$DEPLOYER_SA" roles/secretmanager.viewer
gc artifacts repositories add-iam-policy-binding "$REPOSITORY" --location="$REGION" \
  --member="serviceAccount:$DEPLOYER_SA" --role=roles/artifactregistry.writer >/dev/null
gc iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$DEPLOYER_SA" --role=roles/iam.serviceAccountUser >/dev/null

step "What Infisical's sync may do: create and update this project's secrets"
project_role "serviceAccount:$INFISICAL_SA" roles/secretmanager.admin
if [[ -n "$INFISICAL_PRINCIPAL" ]]; then
  # Infisical signs in as its own Google service account and acts as ours.
  gc iam service-accounts add-iam-policy-binding "$INFISICAL_SA" \
    --member="serviceAccount:$INFISICAL_PRINCIPAL" --role=roles/iam.serviceAccountTokenCreator >/dev/null
  echo "Infisical ($INFISICAL_PRINCIPAL) may now act as $INFISICAL_SA"
fi

step "GitHub keyless sign-in (workload identity pool $POOL_ID)"
if ! gc iam workload-identity-pools describe "$POOL_ID" --location=global >/dev/null 2>&1; then
  gc iam workload-identity-pools create "$POOL_ID" --location=global \
    --display-name="GitHub Actions"
fi
PROVIDER_CONDITION="assertion.repository_id == '$GITHUB_REPOSITORY_ID' && assertion.repository_owner_id == '$GITHUB_OWNER_ID' && assertion.environment == '$ENVIRONMENT'"
PROVIDER_MAPPING="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment"
if gc iam workload-identity-pools providers describe "$PROVIDER_ID" --location=global \
  --workload-identity-pool="$POOL_ID" >/dev/null 2>&1; then
  gc iam workload-identity-pools providers update-oidc "$PROVIDER_ID" --location=global \
    --workload-identity-pool="$POOL_ID" \
    --attribute-mapping="$PROVIDER_MAPPING" --attribute-condition="$PROVIDER_CONDITION"
else
  gc iam workload-identity-pools providers create-oidc "$PROVIDER_ID" --location=global \
    --workload-identity-pool="$POOL_ID" --display-name="frapplive/Frapp" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$PROVIDER_MAPPING" --attribute-condition="$PROVIDER_CONDITION"
fi
POOL_PRINCIPAL="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.environment/$ENVIRONMENT"
gc iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --member="$POOL_PRINCIPAL" --role=roles/iam.workloadIdentityUser >/dev/null

if [[ "$ENVIRONMENT" == "production" ]]; then
  step "Production's deployer may read staging's images ($STAGING_PROJECT_ID)"
  gcloud --project="$STAGING_PROJECT_ID" --quiet artifacts repositories add-iam-policy-binding "$REPOSITORY" \
    --location="$REGION" --member="serviceAccount:$DEPLOYER_SA" --role=roles/artifactregistry.reader >/dev/null
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
infisicalAccount:   $INFISICAL_SA
identityProvider:   projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/providers/$PROVIDER_ID
EOF
