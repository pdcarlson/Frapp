#!/usr/bin/env bash
# Unit tests for scripts/lib/local-postgres-acl.sh.
#
#   bash scripts/lib/local-postgres-acl.test.sh
#
# Hermetic: `docker` is stubbed, so no daemon, no containers and no database are needed, and
# nothing outside a mktemp dir is touched. Runs under the same `set -euo pipefail` as
# local-dev-setup.sh. No CI job runs this yet — wiring one up is tracked separately.
#
# Most cases here are regression guards for a specific reviewed failure, not coverage for its
# own sake. The load-bearing ones: a lone FOREIGN stack must never be substituted (repairing
# another project's database, or recommending --reset-supabase-data off its logs, is the
# wrong-container class the lib exists to prevent), `project_id` must be read only from the
# top level (a planted key in [auth.third_party.*] or [remotes.*] otherwise aims the resolver
# at another checkout), and a URL must be rejected unless its HOST is loopback (libpq lets
# ?host=, ?hostaddr= and comma failover lists route off-box while the string still reads local).
set -euo pipefail
FRAPP_ACL_LOG_PREFIX='[test]'
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/local-postgres-acl.sh"

PASS=0; FAIL=0
check() { # name expected_out expected_rc actual_out actual_rc
  if [ "$2" = "$4" ] && [ "$3" = "$5" ]; then
    printf '  PASS  %-52s rc=%s out=%q\n' "$1" "$5" "$4"; PASS=$((PASS + 1))
  else
    printf '  FAIL  %-52s expected rc=%s out=%q, got rc=%s out=%q\n' "$1" "$3" "$2" "$5" "$4"; FAIL=$((FAIL + 1))
  fi
}
ok() { printf '  PASS  %-52s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  FAIL  %-52s %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

# Fake daemon.
#   STUB_NAMES    newline-separated running container names
#   STUB_STOPPED  names visible only with -a
#   STUB_WORKDIR  the com.supabase.cli.workdir label the stub containers carry ('' = unlabelled)
# Mirrors docker: `--filter name=X` is an UNANCHORED regex, label filters are exact-match,
# and multiple --filter flags are ANDed.
docker() {
  local want_all=false pool f pat
  local name_pats="" label_ok=true
  shift # 'ps'
  while [ $# -gt 0 ]; do
    case "$1" in
      -a) want_all=true ;;
      --filter)
        f="$2"; shift
        case "$f" in
          name=*) name_pats="${name_pats}${f#name=}"$'\n' ;;
          label=com.supabase.cli.workdir=*)
            if [ -z "${STUB_WORKDIR:-}" ] || [ "${f#label=com.supabase.cli.workdir=}" != "${STUB_WORKDIR}" ]; then
              label_ok=false
            fi
            ;;
          label=*) label_ok=false ;;
        esac
        ;;
      --format) shift ;;
    esac
    shift
  done

  [ "$label_ok" = true ] || return 0

  pool="$STUB_NAMES"
  if [ "$want_all" = true ] && [ -n "${STUB_STOPPED:-}" ]; then
    pool="$(printf '%s\n%s' "$STUB_NAMES" "$STUB_STOPPED")"
  fi
  while IFS= read -r pat; do
    [ -n "$pat" ] || continue
    pool="$(printf '%s\n' "$pool" | grep -E "$pat" || true)"
  done <<<"$name_pats"
  printf '%s\n' "$pool"
}

run() { local out rc; out=$(frapp_resolve_supabase_db_container "$1" "${2:-false}" 2>/dev/null) && rc=0 || rc=$?; printf '%s\n%s' "$out" "$rc"; }
o() { printf '%s' "$1" | head -n1; }
r() { printf '%s' "$1" | tail -n1; }

STUB_STOPPED=''; STUB_WORKDIR=''

echo "frapp_resolve_supabase_db_container — name fallback (unlabelled containers)"
STUB_NAMES='supabase_db_Frapp'
x=$(run /home/user/Frapp);  check "exact match, single stack"                 "supabase_db_Frapp" 0 "$(o "$x")" "$(r "$x")"
STUB_NAMES='supabase_db_Frapp
supabase_db_Other'
x=$(run /home/user/Frapp);  check "exact match wins amid siblings"            "supabase_db_Frapp" 0 "$(o "$x")" "$(r "$x")"
# THE #677 REGRESSION GUARD.
STUB_NAMES='supabase_db_Other'
x=$(run /home/user/Frapp);  check "lone FOREIGN stack -> refuses (rc 2)"      "" 2 "$(o "$x")" "$(r "$x")"
STUB_NAMES='supabase_db_Other
supabase_db_Third'
x=$(run /home/user/Frapp);  check "two foreign stacks -> refuses (rc 2)"      "" 2 "$(o "$x")" "$(r "$x")"
STUB_NAMES=''
x=$(run /home/user/Frapp);  check "nothing at all -> rc 1"                    "" 1 "$(o "$x")" "$(r "$x")"
STUB_NAMES='supabase_db_Other
supabase_db_Frapp'
x=$(run /home/user/Frapp);  check "never head -n1 (ordering irrelevant)"      "supabase_db_Frapp" 0 "$(o "$x")" "$(r "$x")"
STUB_NAMES='supabase_db_myXapp'
x=$(run /home/user/my.app); check "metachar dir does NOT match myXapp"        "" 2 "$(o "$x")" "$(r "$x")"
STUB_NAMES='supabase_db_my.app'
x=$(run /home/user/my.app); check "metachar dir matches its literal name"     "supabase_db_my.app" 0 "$(o "$x")" "$(r "$x")"

echo
echo "label path — Docker's own record of the project root wins"
STUB_NAMES='supabase_db_Frapp
supabase_kong_Frapp'
STUB_WORKDIR='/home/user/Frapp'
x=$(run /home/user/Frapp);  check "label match picks the db container"        "supabase_db_Frapp" 0 "$(o "$x")" "$(r "$x")"
# Label says this stack belongs elsewhere: must NOT be substituted, even named identically.
STUB_WORKDIR='/home/user/SomewhereElse'
x=$(run /home/user/Frapp);  check "foreign workdir label -> name fallback"    "supabase_db_Frapp" 0 "$(o "$x")" "$(r "$x")"
STUB_NAMES='supabase_db_Other'
x=$(run /home/user/Frapp);  check "foreign workdir + foreign name -> rc 2"    "" 2 "$(o "$x")" "$(r "$x")"
STUB_WORKDIR=''

echo
echo "include_stopped handling"
STUB_NAMES='supabase_db_Other'; STUB_STOPPED='supabase_db_Frapp'
x=$(run /home/user/Frapp false); check "stopped hidden when include_stopped=false" "" 2 "$(o "$x")" "$(r "$x")"
x=$(run /home/user/Frapp true);  check "stopped seen when include_stopped=true"    "supabase_db_Frapp" 0 "$(o "$x")" "$(r "$x")"
x=$(run /home/user/Frapp 1);     check "truthy '1' also includes stopped"          "supabase_db_Frapp" 0 "$(o "$x")" "$(r "$x")"
x=$(run /home/user/Frapp yes);   check "truthy 'yes' also includes stopped"        "supabase_db_Frapp" 0 "$(o "$x")" "$(r "$x")"
STUB_STOPPED=''

echo
echo "frapp_supabase_db_container_name — TOP-LEVEL project_id only"
d=$(mktemp -d)/MyDir; mkdir -p "$d/supabase"
check "no config.toml -> basename"                "supabase_db_MyDir" 0 "$(frapp_supabase_db_container_name "$d")" 0
printf '[db]\nport = 54322\n' >"$d/supabase/config.toml"
check "config without project_id -> basename"     "supabase_db_MyDir" 0 "$(frapp_supabase_db_container_name "$d")" 0
printf 'project_id = "frapp-local"\n[db]\nport = 1\n' >"$d/supabase/config.toml"
check "top-level project_id (double quotes)"      "supabase_db_frapp-local" 0 "$(frapp_supabase_db_container_name "$d")" 0
printf "project_id = 'frapp-alt'\n" >"$d/supabase/config.toml"
check "top-level project_id (single quotes)"      "supabase_db_frapp-alt" 0 "$(frapp_supabase_db_container_name "$d")" 0
printf '# project_id = "commented"\n' >"$d/supabase/config.toml"
check "commented-out project_id ignored"          "supabase_db_MyDir" 0 "$(frapp_supabase_db_container_name "$d")" 0
# The hijack the verifier demonstrated: a project_id inside a table the CLI never reads.
printf '[auth.third_party.firebase]\nenabled = true\nproject_id = "Frapp"\n' >"$d/supabase/config.toml"
check "project_id in [auth.third_party.*] ignored" "supabase_db_MyDir" 0 "$(frapp_supabase_db_container_name "$d")" 0
printf '[remotes.staging]\nproject_id = "Frapp"\n' >"$d/supabase/config.toml"
check "project_id in [remotes.*] ignored"          "supabase_db_MyDir" 0 "$(frapp_supabase_db_container_name "$d")" 0
printf 'project_id = "real"\n[auth.third_party.firebase]\nproject_id = "Frapp"\n' >"$d/supabase/config.toml"
check "top-level wins over a nested decoy"         "supabase_db_real" 0 "$(frapp_supabase_db_container_name "$d")" 0

echo
echo "_frapp_db_url_is_local — host must be loopback, not merely look it"
for u in 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
         'postgresql://127.0.0.1:54322/postgres' \
         'postgresql://postgres@localhost:54322/postgres' \
         'postgresql://postgres@[::1]:54322/postgres' \
         'postgresql://postgres:p@ss@127.0.0.1:54322/postgres' \
         'postgresql://pw@127.13.2.9:5432/db'; do
  if _frapp_db_url_is_local "$u"; then ok "LOCAL  ${u:0:46}"; else no "expected LOCAL" "$u"; fi
done
for u in 'postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=example.invalid' \
         'postgresql://postgres:postgres@127.0.0.1:54322/postgres?hostaddr=203.0.113.9' \
         'postgresql://postgres:postgres@127.0.0.1:9,example.invalid:5432/postgres' \
         'postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres' \
         'postgresql://pw@127.evil.example.com:5432/db' \
         'postgresql://pw@1270.0.0.1:5432/db' \
         'postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres'; do
  if _frapp_db_url_is_local "$u"; then no "expected REJECT" "$u"; else ok "REJECT ${u:0:46}"; fi
done

echo
echo "SQL integrity"
case "$FRAPP_LOCAL_ACL_SQL" in
  *execute* | *EXECUTE*) no "SQL must never grant function EXECUTE" ;;
  *) ok "SQL grants no function EXECUTE" ;;
esac
case "$FRAPP_LOCAL_ACL_SQL" in
  *'$'* | *'`'*) no "SQL still contains a shell metacharacter" ;;
  *) ok "SQL is free of shell-expandable metacharacters" ;;
esac

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
