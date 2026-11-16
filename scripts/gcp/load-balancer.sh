#!/usr/bin/env bash
#
# The front door for the API on Cloud Run (#5228): a global external
# Application Load Balancer that answers on the API's own address and passes
# requests to the `frapp-api` service.
#
# Run it in Cloud Shell, signed in as an owner of the frapp.live organization,
# after scripts/gcp/bootstrap.sh and after the first deploy has created the
# service:
#
#   bash scripts/gcp/load-balancer.sh staging <nonprod-project-id>
#   bash scripts/gcp/load-balancer.sh production <prod-project-id>
#
# It is safe to run again: every step looks for what it would create first, and
# a run after the DNS records are in place reports where the certificate is.
#
# Why a load balancer: Cloud Run's own domain mapping is a preview that Google
# calls not production-ready and doesn't offer in us-east5, and a balancer is
# where Cloud Armor, a second region or a CDN would attach later. It costs about
# $18 a month per environment (one forwarding-rule hour rate covers both ports).
#
# The certificate is a Google-managed one proved by a DNS record
# (_acme-challenge), not by traffic, so it is issued while the address still
# points at the old host. The address moves only once the certificate is
# ACTIVE, and nothing answers without TLS in between. Two DNS records, in order:
#
#   1. the _acme-challenge CNAME this script prints (safe to add any time);
#   2. once a rerun says the certificate is ACTIVE, the API host's A record,
#      pointing at the balancer's address (this is the cutover).
#
# Every request is logged at the balancer (sample rate 1.0), next to the
# service's own request log.

set -euo pipefail

STAGING_REGION="us-east4"
PRODUCTION_REGION="us-east5"
STAGING_HOST="api-staging.frapp.live"
PRODUCTION_HOST="api.frapp.live"
SERVICE="frapp-api"

ADDRESS="frapp-api-ip"
NEG="frapp-api-neg"
BACKEND="frapp-api-backend"
URL_MAP="frapp-api"
REDIRECT_MAP="frapp-api-http-redirect"
DNS_AUTH="frapp-api-dns-auth"
CERT="frapp-api-cert"
CERT_MAP="frapp-api-certs"
CERT_MAP_ENTRY="frapp-api-host"
HTTPS_PROXY="frapp-api-https"
HTTP_PROXY="frapp-api-http"
HTTPS_RULE="frapp-api-https"
HTTP_RULE="frapp-api-http"

usage() {
  echo "usage: bash scripts/gcp/load-balancer.sh <staging|production> <project-id>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
ENVIRONMENT="$1"
PROJECT_ID="$2"
case "$ENVIRONMENT" in
  staging) REGION="$STAGING_REGION"; HOST="$STAGING_HOST" ;;
  production) REGION="$PRODUCTION_REGION"; HOST="$PRODUCTION_HOST" ;;
  *) usage ;;
esac

step() { printf '\n==> %s\n' "$*"; }
gc() { gcloud --project="$PROJECT_ID" --quiet "$@"; }
exists() { gc "$@" >/dev/null 2>&1; }

step "Checking project $PROJECT_ID"
PROJECT_NAME="$(gcloud projects describe "$PROJECT_ID" --format='value(name)')"
LOWER_NAME="$(printf '%s %s' "$PROJECT_NAME" "$PROJECT_ID" | tr '[:upper:]' '[:lower:]')"
if [[ "$ENVIRONMENT" == "staging" && "$LOWER_NAME" != *nonprod* && "$LOWER_NAME" != *staging* ]]; then
  echo "Project $PROJECT_ID is named \"$PROJECT_NAME\", which doesn't look like the nonprod project. Refusing to point $HOST at it." >&2
  exit 1
fi
if [[ "$ENVIRONMENT" == "production" && ( "$LOWER_NAME" == *nonprod* || "$LOWER_NAME" == *staging* || "$LOWER_NAME" != *prod* ) ]]; then
  echo "Project $PROJECT_ID is named \"$PROJECT_NAME\", which doesn't look like the prod project. Refusing to point $HOST at it." >&2
  exit 1
fi
if ! exists run services describe "$SERVICE" --region="$REGION"; then
  echo "There is no Cloud Run service $SERVICE in $REGION yet. Let a deploy create it first, then run this again." >&2
  exit 1
fi
echo "\"$PROJECT_NAME\", service $SERVICE in $REGION, host $HOST"

step "Turning on Compute Engine (load balancing) and Certificate Manager"
gc services enable compute.googleapis.com certificatemanager.googleapis.com

step "Static address $ADDRESS"
if ! exists compute addresses describe "$ADDRESS" --global; then
  gc compute addresses create "$ADDRESS" --global --ip-version=IPV4 --network-tier=PREMIUM
fi
IP="$(gc compute addresses describe "$ADDRESS" --global --format='value(address)')"

step "Backend: $SERVICE in $REGION, every request logged"
if ! exists compute network-endpoint-groups describe "$NEG" --region="$REGION"; then
  gc compute network-endpoint-groups create "$NEG" --region="$REGION" \
    --network-endpoint-type=serverless --cloud-run-service="$SERVICE"
fi
if ! exists compute backend-services describe "$BACKEND" --global; then
  gc compute backend-services create "$BACKEND" --global --load-balancing-scheme=EXTERNAL_MANAGED \
    --enable-logging --logging-sample-rate=1.0
  gc compute backend-services add-backend "$BACKEND" --global \
    --network-endpoint-group="$NEG" --network-endpoint-group-region="$REGION"
else
  gc compute backend-services update "$BACKEND" --global --enable-logging --logging-sample-rate=1.0 >/dev/null
fi
if ! exists compute url-maps describe "$URL_MAP" --global; then
  gc compute url-maps create "$URL_MAP" --global --default-service="$BACKEND"
fi

step "Certificate for $HOST, proved by a DNS record"
if ! exists certificate-manager dns-authorizations describe "$DNS_AUTH"; then
  gc certificate-manager dns-authorizations create "$DNS_AUTH" --domain="$HOST"
fi
CHALLENGE_NAME="$(gc certificate-manager dns-authorizations describe "$DNS_AUTH" --format='value(dnsResourceRecord.name)')"
CHALLENGE_DATA="$(gc certificate-manager dns-authorizations describe "$DNS_AUTH" --format='value(dnsResourceRecord.data)')"
if ! exists certificate-manager certificates describe "$CERT"; then
  gc certificate-manager certificates create "$CERT" --domains="$HOST" --dns-authorizations="$DNS_AUTH"
fi
if ! exists certificate-manager maps describe "$CERT_MAP"; then
  gc certificate-manager maps create "$CERT_MAP"
fi
if ! exists certificate-manager maps entries describe "$CERT_MAP_ENTRY" --map="$CERT_MAP"; then
  gc certificate-manager maps entries create "$CERT_MAP_ENTRY" --map="$CERT_MAP" \
    --certificates="$CERT" --hostname="$HOST"
fi
CERT_STATE="$(gc certificate-manager certificates describe "$CERT" --format='value(managed.state)')"

step "HTTPS on $IP:443"
if ! exists compute target-https-proxies describe "$HTTPS_PROXY" --global; then
  gc compute target-https-proxies create "$HTTPS_PROXY" --global \
    --url-map="$URL_MAP" --certificate-map="$CERT_MAP"
fi
if ! exists compute forwarding-rules describe "$HTTPS_RULE" --global; then
  gc compute forwarding-rules create "$HTTPS_RULE" --global --load-balancing-scheme=EXTERNAL_MANAGED \
    --network-tier=PREMIUM --address="$ADDRESS" --target-https-proxy="$HTTPS_PROXY" --ports=443
fi

# Calendar apps fetch a webcal:// feed over plain HTTP, so port 80 answers with
# a redirect to HTTPS (308 keeps the method) rather than not at all.
step "HTTP on $IP:80, redirecting to HTTPS"
if ! exists compute url-maps describe "$REDIRECT_MAP" --global; then
  gc compute url-maps import "$REDIRECT_MAP" --global --source=/dev/stdin <<YAML
name: $REDIRECT_MAP
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: PERMANENT_REDIRECT
YAML
fi
if ! exists compute target-http-proxies describe "$HTTP_PROXY" --global; then
  gc compute target-http-proxies create "$HTTP_PROXY" --global --url-map="$REDIRECT_MAP"
fi
if ! exists compute forwarding-rules describe "$HTTP_RULE" --global; then
  gc compute forwarding-rules create "$HTTP_RULE" --global --load-balancing-scheme=EXTERNAL_MANAGED \
    --network-tier=PREMIUM --address="$ADDRESS" --target-http-proxy="$HTTP_PROXY" --ports=80
fi

step "Done. Paste this block back into the chat (none of it is secret):"
cat <<EOF
environment:        $ENVIRONMENT
host:               $HOST
balancerAddress:    $IP
certificateState:   ${CERT_STATE:-unknown}
challengeRecord:    CNAME ${CHALLENGE_NAME%.} -> $CHALLENGE_DATA
cutoverRecord:      A $HOST -> $IP   (only once certificateState is ACTIVE)
EOF
