#!/usr/bin/env bash
# Re-copy ALL rows from one Supabase project (OLD) into another (NEW) whose
# schema is already in place (pg_restore of the public schema; docs/speed-plan.md E).
#
# NEW is TRUNCATED first and refilled from one pg_dump snapshot of OLD. Run it
# inside a maintenance window: OLD must be write-quiet, or rows written after
# the snapshot are lost. If the copy dies after the truncate, NEW is left
# half-filled and without the signup trigger — re-run before pointing the app
# at it. Needs Docker (postgres:17, host networking: Supabase's direct host is
# IPv6-only). Exits non-zero unless every table and the auth counts match.
#
# Usage: db-recopy.sh <OLD_DB_URL> <NEW_DB_URL>     (plain URLs, no ?query)
set -euo pipefail
OLD="${1:?usage: db-recopy.sh <OLD_DB_URL> <NEW_DB_URL>}"; NEW="${2:?usage: db-recopy.sh <OLD_DB_URL> <NEW_DB_URL>}"
OLD="${OLD%%\?*}?sslmode=require"; NEW="${NEW%%\?*}?sslmode=require"
# The URLs reach the container through the environment, not the command line,
# so the passwords never show in `ps`.
export OLD NEW
PG="docker run --rm -i --network host -e OLD -e NEW postgres:17"
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
half='echo "db-recopy FAILED: NEW may be half-copied and without the on_auth_user_created trigger — re-run before cutover" >&2'
t0=$(date +%s)

TABLES_Q="select string_agg(quote_ident(relname), ', ' order by relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'"
A=$($PG sh -c 'psql "$OLD" -tA -c "$0"' "$TABLES_Q"); B=$($PG sh -c 'psql "$NEW" -tA -c "$0"' "$TABLES_Q")
[ "$A" = "$B" ] || { echo "table lists differ — OLD: $A / NEW: $B" >&2; exit 1; }
TABLES=$(echo "$A" | sed 's/\([^, ]*\)/public.\1/g')

echo "1 dump (one snapshot: every public table + auth.users + auth.identities)"
$PG sh -c 'pg_dump "$OLD" --data-only --no-owner --format=custom -t "public.*" -t auth.users -t auth.identities' > "$D/data.dump"
echo "   $(( $(date +%s) - t0 ))s, $(du -h "$D/data.dump" | cut -f1)"

trap "$half; rm -rf '$D'" EXIT
echo "2 truncate + drop trigger"
$PG sh -c 'psql "$NEW" -v ON_ERROR_STOP=1 -q -c "$0"' "drop trigger if exists on_auth_user_created on auth.users; truncate auth.identities, auth.users, $TABLES cascade;" 2> >(grep -vE '^(NOTICE|DETAIL|HINT)' >&2)
echo "3 restore"
$PG sh -c 'pg_restore --dbname="$NEW" --data-only --no-owner --exit-on-error' < "$D/data.dump"
echo "4 trigger + analyze"
$PG sh -c 'psql "$NEW" -v ON_ERROR_STOP=1 -q -c "create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();" -c "analyze"' 2> >(grep -v WARNING >&2)
# The TRUNCATE in step 2 rebuilt every ivfflat index on an EMPTY table, so its
# centroids are garbage and all the rows reloaded in step 3 fell into a few
# lists: a probe then reads the whole index (seen 2026-11-05: 93 MB per query,
# >8 s, "Find more" timing out). Rebuild them now that the rows are there.
echo "4b rebuild ivfflat indexes"
for idx in $($PG sh -c 'psql "$NEW" -tA -c "$0"' "select indexname from pg_indexes where schemaname='public' and indexdef ilike '%ivfflat%'"); do
  $PG sh -c 'psql "$NEW" -v ON_ERROR_STOP=1 -q -c "$0" -c "$1"' "set maintenance_work_mem = '256MB'" "reindex index concurrently public.$idx" && echo "   $idx"
done
trap 'rm -rf "$D"' EXIT

echo "5 exact counts old vs new"
COUNTS="select string_agg(relname||'='||(xpath('/row/c/text()', query_to_xml('select count(*) c from public.'||quote_ident(relname), false, true, '')))[1]::text, ' ' order by relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'"
AUTH="select (select count(*) from auth.users)||'/'||(select count(*) from auth.identities)"
A=$($PG sh -c 'psql "$OLD" -tA -c "$0"' "$COUNTS"); B=$($PG sh -c 'psql "$NEW" -tA -c "$0"' "$COUNTS")
AA=$($PG sh -c 'psql "$OLD" -tA -c "$0"' "$AUTH"); AB=$($PG sh -c 'psql "$NEW" -tA -c "$0"' "$AUTH")
echo "   old: $A"; echo "   new: $B"; echo "   auth users/identities old: $AA  new: $AB"
echo "total $(( $(date +%s) - t0 ))s"
[ "$A" = "$B" ] && [ "$AA" = "$AB" ] && echo "   MATCH" || { echo "   MISMATCH" >&2; exit 1; }
